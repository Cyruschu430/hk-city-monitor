#!/usr/bin/env python3
r"""publish_live.py - push a live JSON file to a GitHub branch the browser can read.

THE PROBLEM THIS SOLVES. The deployed bundle carries a snapshot of every data file from build time.
That is fine for reference data and wrong for anything with a cadence: aircraft and berths change
every few minutes, and rebuilding + redeploying on that cadence is 720 deploys a day against a free
tier that allows 500 builds a MONTH. So the live files must be readable from somewhere that updates
without a build.

WHY GITHUB RAW. raw.githubusercontent.com sends `access-control-allow-origin: *`, needs no key from
the browser, and the repository is already public — so this adds no exposure that does not already
exist. A VPS-hosted copy would put a host in the shipped bundle, which the project's own rule
forbids.

ONE ORPHAN BRANCH, FORCE-PUSHED EVERY RUN. Force-push keeps it at exactly one commit, so this does
not grow the repository by hundreds of commits a day and the branch history carries no value worth
keeping. Branch name: `live-data`.

NEEDS A PUSH CREDENTIAL, AND SAYS SO WHEN IT HAS NONE. The HTTPS remote is the default, and a host
without a credential cannot push to it: the dry-run probe then fails loudly, having pushed nothing,
rather than the push failing halfway through building a temp repo. A host that does have one points
$HKCM_REMOTE at the URL it can push to — an SSH remote backed by an account key or a repo-scoped
deploy key, or a fine-grained PAT (`.github_token`, gitignored, NEVER committed). Which of those a
machine has is an environment fact, not a code change. MEASURED 2026-09-28: exit 3 on the PC, which
collects but cannot authenticate, and exit 0 from the VPS with a repo-scoped deploy key.

Usage:  py publish_live.py data/aircraft.json data/berth_vacancy.json
"""
import json
import os, subprocess, sys, tempfile, shutil
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
BRANCH = "live-data"
# The HTTPS remote is the default because it is what a fresh checkout has, and it is
# the honest answer for a machine with no push credential: the dry-run probe below
# then fails loudly instead of the push failing halfway. A host that DOES have one
# (an SSH key, a token) points $HKCM_REMOTE at the URL it can actually push to —
# that override is the only difference between "blocked" and "published", and it is
# an environment fact, not a code change.
REPO = os.environ.get("HKCM_REMOTE") or "https://github.com/Cyruschu430/hk-city-monitor.git"
RAW = "https://raw.githubusercontent.com/Cyruschu430/hk-city-monitor"


def git(*args, cwd):
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=300)



# EVERY FILE THIS RUN DOES NOT PUBLISH MUST BE CARRIED FORWARD.
#
# The push below is an ORPHAN commit: whatever is not in the temp repo stops existing on the branch.
# A hardcoded keep-list was the first attempt and it was wrong in the obvious way - it protected
# ai_summary.json from the collector but not the collector's three files from a brief publish, so
# running this script for the brief deleted aircraft/berth/water (measured 2026-10-02, branch left
# holding README.md and ai_summary.json only). The rule is not "remember the other files": it is
# "this script owns the files it was handed and nothing else".
#
# The list comes from the GitHub contents API. It cannot go stale the way a constant does.
#
# MEASURED 2026-10-05 - "a public repo needs no token" was WRONG and it was the bug. Anonymous
# API calls get 60 requests an hour PER IP; GitHub Actions runners share egress IPs, so the
# listing died with `HTTP 403: rate limit exceeded` at random and the job went red (last seen
# 2026-10-05 06:00 in ai-brief, AFTER the brief itself had been skipped - the brief was never
# the broken part, which is why it looked like "ai-brief 成日 fail"). With a token: 5,000/hr.
# The token is DISCOVERED, never required - an anonymous call still works, just 60/hr.
API = "https://api.github.com/repos/Cyruschu430/hk-city-monitor/contents"


def _api_token() -> str:
    """Token for the contents API, or '' to fall back to the anonymous 60/hr budget."""
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
    if tok:
        return tok
    # Every workflow already hides one inside HKCM_REMOTE:
    #   https://x-access-token:<token>@github.com/owner/repo.git
    try:
        netloc = urllib.parse.urlsplit(REPO).netloc
        if "@" in netloc:
            userinfo = netloc.rsplit("@", 1)[0]
            return userinfo.split(":", 1)[1] if ":" in userinfo else ""
    except ValueError:
        pass
    return ""


def carry_forward(tmp: str, files: list[str]) -> None:
    """Copy every file already on the branch that this run is not replacing."""
    have = {os.path.basename(f) for f in files}
    token = _api_token()
    req_headers = {"User-Agent": "hkcm-collector",
                   "Accept": "application/vnd.github+json"}
    if token:
        req_headers["Authorization"] = f"Bearer {token}"
    try:
        req = urllib.request.Request(f"{API}?ref={BRANCH}", headers=req_headers)
        with urllib.request.urlopen(req, timeout=20) as r:
            listing = json.loads(r.read().decode())
        print(f"LIST  {BRANCH}: {len(listing)} entr(ies) via "
              f"{'authenticated' if token else 'ANONYMOUS (60/hr - set GITHUB_TOKEN)'} API")
    except Exception as e:  # noqa: BLE001
        print(f"FAIL  cannot list {BRANCH}: {e} - refusing to publish, this push would delete files",
              file=sys.stderr)
        raise SystemExit(4)
    for entry in listing:
        name = entry.get("name", "")
        if not name or name in have or entry.get("type") != "file":
            continue
        try:
            with urllib.request.urlopen(urllib.request.Request(entry["download_url"],
                                             headers={"User-Agent": "hkcm-collector"}), timeout=20) as r:
                data = r.read()
            with open(os.path.join(tmp, name), "wb") as fh:
                fh.write(data)
            print(f"KEEP  {name} carried forward ({len(data)} bytes)")
        except Exception as e:  # noqa: BLE001
            print(f"FAIL  cannot carry {name}: {e} - refusing to publish", file=sys.stderr)
            raise SystemExit(4)


def main():
    files = sys.argv[1:] or ["data/aircraft.json", "data/berth_vacancy.json"]
    missing = [f for f in files if not os.path.exists(os.path.join(ROOT, f))]
    if missing:
        print(f"FAIL missing {missing}", file=sys.stderr)
        return 1

    # Reachability first: a push that fails after a temp repo is built wastes a minute and says
    # nothing useful. `ls-remote` is a READ, and this repository is public, so it succeeds even
    # when authentication is broken - which is exactly the trap this check exists to avoid
    # (an earlier session read a successful ls-remote as proof that push worked).
    #
    # --force is NOT decoration. The real push below is forced (one orphan commit by design), so a
    # probe without it tests a different operation: from the second run onwards the branch already
    # exists at another commit and a non-forced update is rejected as a non-fast-forward, which
    # this check then reported as "this PC cannot push to GitHub" on a host whose key was fine.
    # MEASURED 2026-09-28, one run after the branch was created.
    probe = git("push", "--dry-run", "--force", REPO, f"HEAD:refs/heads/{BRANCH}", cwd=ROOT)
    if probe.returncode != 0:
        tail = (probe.stderr or probe.stdout or "").strip().splitlines()[-1:] or [""]
        print("BLOCKED this host cannot push to GitHub: " + tail[0], file=sys.stderr)
        print("BLOCKED see the docstring for the three ways to fix it. Nothing was published.",
              file=sys.stderr)
        return 3

    tmp = tempfile.mkdtemp(prefix="hkcm-live-")
    try:
        git("init", "-q", cwd=tmp)
        carry_forward(tmp, files)
        for f in files:
            shutil.copy2(os.path.join(ROOT, f), os.path.join(tmp, os.path.basename(f)))
        with open(os.path.join(tmp, "README.md"), "w", encoding="utf-8") as fh:
            fh.write("# live-data\n\nForce-pushed every run by `scripts/publish_live.py`. "
                     "One commit by design: this branch is a transport for the newest reading, "
                     "not a history. Read the files from raw.githubusercontent.com.\n")
        git("add", "-A", cwd=tmp)
        git("-c", "user.email=collector@local", "-c", "user.name=HKCM collector",
            "commit", "-qm", "live data", cwd=tmp)
        git("branch", "-M", BRANCH, cwd=tmp)
        git("remote", "add", "origin", REPO, cwd=tmp)
        out = git("push", "-f", "origin", BRANCH, cwd=tmp)
        if out.returncode != 0:
            print("FAIL push failed: " + (out.stderr or "").strip()[-300:], file=sys.stderr)
            return 1
        print(f"OK   pushed {len(files)} file(s) to {BRANCH}: " + ", ".join(os.path.basename(f) for f in files))
        print(f"     browser URL: {RAW}/{BRANCH}/<file>")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
