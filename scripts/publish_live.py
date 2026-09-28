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

BLOCKED ON ONE MANUAL STEP. This PC cannot authenticate to GitHub — `credentialStore=wincredman`
cannot persist a credential, and the SSH key that works lives on the VPS. Either:
  - an SSH key on this PC added to the GitHub account, and the remote switched to SSH, or
  - a fine-grained PAT in .github_token (gitignored, NEVER committed), or
  - fix the credential store:  git config --global credential.credentialStore dpapi
Until one of those is true this script exits 3 and says so, having pushed nothing.

Usage:  py publish_live.py data/aircraft.json data/berth_vacancy.json
"""
import os, subprocess, sys, tempfile, shutil

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
    probe = git("push", "--dry-run", REPO, f"HEAD:refs/heads/{BRANCH}", cwd=ROOT)
    if probe.returncode != 0:
        tail = (probe.stderr or probe.stdout or "").strip().splitlines()[-1:] or [""]
        print("BLOCKED this PC cannot push to GitHub: " + tail[0], file=sys.stderr)
        print("BLOCKED see the docstring for the three ways to fix it. Nothing was published.",
              file=sys.stderr)
        return 3

    tmp = tempfile.mkdtemp(prefix="hkcm-live-")
    try:
        git("init", "-q", cwd=tmp)
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
