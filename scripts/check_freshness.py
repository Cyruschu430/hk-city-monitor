#!/usr/bin/env python3
"""HK City Monitor — freshness watchdog (designed to run from cron).

Reads the source registry plus the last probe report and answers one question per
source: is it still fresh enough to show, or has it gone stale? Exits non-zero
when anything is stale, so cron mails you only when there is a decision to make —
a report that is always "fine" trains you to ignore it.

It also separates the two kinds of source, because they fail differently:

  kind: api       machine-readable — staleness means the collector is broken.
  kind: document  a page, PDF, spreadsheet or a private index — no endpoint to
                  poll. Staleness here means "a new edition should exist by now,
                  go look", which is a human/agent task, not a crash.

Cadence is taken from each source's existing `cadence` field (2 minutes, hourly,
daily, monthly, ...), so adding a source needs no extra bookkeeping.

USAGE
    python3 scripts/check_freshness.py                 # check, human-readable
    python3 scripts/check_freshness.py --json out.json  # plus machine output
    python3 scripts/check_freshness.py --grace 2        # allow 2x the cadence

CRON (daily 07:00 HKT, mail only on failure)
    0 7 * * *  cd /var/www/hk-monitor && python3 scripts/check_freshness.py || \\
               python3 scripts/check_freshness.py --json /tmp/hkcm-freshness.json

NOTE this checks whether WE refreshed our copy, not whether the upstream changed.
The upstream half is sources.json + probe_sources.py; this is the half that says
'we were supposed to have re-pulled this by now'.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REGISTRY = os.path.join(ROOT, "sources.json")
PROBE_REPORT = os.path.join(ROOT, "data", "sources_report.json")

# cadence text -> how many hours may pass before we call it stale. Anything not
# listed is treated as no-SLA (we never claim it is current).
HOURS = {
    "real-time": 1, "10 seconds": 1 / 6, "sub-minute": 1, "1 minute": 1 / 30,
    "2 minutes": 2 / 60, "5 minutes": 5 / 60, "6 minutes": 0.2, "15 minutes": 0.5,
    "hourly": 2, "10 minutes": 0.5, "6 hours": 12, "daily": 30, "twice daily": 18,
    "continuous": 48, "as issued": 72, "weekly": 10 * 24, "monthly": 40 * 24,
    "half-yearly": 200 * 24, "quarterly": 100 * 24, "annual": 400 * 24,
    "decennial": 3650 * 24, "irregular": None, "periodic": None, "on update": None,
    "snapshot": None, "static": None, "frozen": None, "live": 2,
}


def sla_hours(cadence: str):
    c = (cadence or "").strip().lower()
    if c in HOURS:
        return HOURS[c]
    m = re.match(r"^(\d+(?:\.\d+)?)\s*(minute|min|hour|day|week|month|year)s?$", c)
    if m:
        n, unit = float(m.group(1)), m.group(2)
        return n * {"minute": 1 / 60, "min": 1 / 60, "hour": 1, "day": 24,
                    "week": 168, "month": 730, "year": 8760}[unit]
    return None                                    # unknown cadence = no SLA


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grace", type=float, default=1.5,
                    help="multiplier on the cadence before calling it stale (default 1.5)")
    ap.add_argument("--json", help="also write the full result here")
    args = ap.parse_args()

    with open(REGISTRY, encoding="utf-8") as f:
        sources = json.load(f)["sources"]

    probed_at, probed_ids = None, set()
    if os.path.exists(PROBE_REPORT):
        with open(PROBE_REPORT, encoding="utf-8") as f:
            rep = json.load(f)
        probed_at = rep.get("probed_at")
        probed_ids = {r["id"] for r in rep.get("results", []) if r.get("status") == "ok"}

    if probed_at:
        # probed_at looks like 2026-09-18T19:33:00+0800
        stamp = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", probed_at)
        age_hours = (time.time() - time.mktime(time.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S"))) / 3600
    else:
        age_hours = None

    rows, stale = [], []
    for s in sources:
        sla = sla_hours(s.get("cadence", ""))
        kind = s.get("kind", "api")
        if sla is None:
            state = "no-sla"
        elif age_hours is None:
            state = "never-probed"
        elif age_hours > sla * args.grace:
            state = "needs-review" if kind == "document" else "STALE"
        else:
            state = "fresh"
        row = {"id": s["id"], "name": s["name"], "kind": kind, "cadence": s.get("cadence", ""),
               "sla_hours": sla, "age_hours": None if age_hours is None else round(age_hours, 2),
               "state": state, "probed_ok": s["id"] in probed_ids, "todo": bool(s.get("todo"))}
        rows.append(row)
        if state in ("STALE", "needs-review", "never-probed"):
            stale.append(row)

    counts = {}
    for r in rows:
        counts[r["state"]] = counts.get(r["state"], 0) + 1

    print(f"HK City Monitor freshness — {len(rows)} sources"
          + (f", last probe {age_hours:.1f}h ago" if age_hours is not None else ", never probed"))
    print("  " + "  ".join(f"{k}={v}" for k, v in sorted(counts.items())))

    actionable = [r for r in stale if r["state"] in ("STALE", "needs-review")]
    if actionable:
        print("\nDECISION NEEDED:")
        for r in sorted(actionable, key=lambda r: (r["kind"], r["id"])):
            verb = "collector is broken or not scheduled" if r["kind"] == "api" else "a new edition should exist — review and re-extract"
            print(f"  [{r['state']:<12}] {r['id']:<24} cadence={r['cadence']:<12} {verb}")
    else:
        print("\nNothing stale. No action.")

    missing = [r for r in rows if r["state"] == "never-probed"]
    if missing:
        print(f"\n{len(missing)} source(s) never probed successfully — run scripts/probe_sources.py")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"checked_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                       "last_probe": probed_at, "counts": counts, "sources": rows}, f,
                      ensure_ascii=False, indent=1)
        print(f"\nwrote {args.json}")

    # never fail a run where we simply have no SLA data to judge — that is noise,
    # not a decision. Fail only on real staleness.
    return 1 if any(r["state"] == "STALE" for r in stale) else 0


if __name__ == "__main__":
    sys.exit(main())
