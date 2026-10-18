#!/usr/bin/env python3
"""Fail when a reference snapshot has not been refreshed in longer than its cadence allows.

WHY COMMIT DATES AND NOT MTIME. A CI checkout writes every file at checkout time, so mtime says
"everything is fresh" in exactly the place the check runs. The commit date of the file is the only
timestamp that survives a clone.

WHY THIS EXISTS AT ALL. The snapshots used to change only when somebody ran a builder by hand,
which meant a panel could be correct on the day it shipped and wrong a fortnight later with nothing
reporting it. scripts/snapshot_cycle.sh now refreshes them daily; this is the half that notices
when that stopped happening.

Usage:  python3 scripts/check_snapshot_age.py [--json out.json]
Exit:   0 all inside their window, 1 something has gone stale.
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import date, datetime

# file -> days after which the copy is no longer worth trusting as "current".
# The windows are 2x the publisher's own cadence, so a missed run is not a failure and a
# silent fortnight is.
MAX_AGE_DAYS = {
    "data/bus_routes.json": 14,
    "data/bus_stops.json": 60,
    "data/lcsd_facilities.geojson": 30,
    "data/parking_meters.geojson": 30,
    "data/carpark_info.json": 30,
    "data/hiking_trails.geojson": 120,
    "data/ev_chargers.geojson": 120,
    "data/aed.json": 60,
    "data/smartplay_activities.json": 14,
}


def last_commit_date(path: str) -> date | None:
    out = subprocess.run(
        ["git", "log", "-1", "--format=%cs", "--", path],
        capture_output=True, text=True, check=False,
    ).stdout.strip()
    if not out:
        return None
    return datetime.strptime(out, "%Y-%m-%d").date()


def main() -> int:
    today = date.today()
    stale, missing = [], []
    for path, limit in MAX_AGE_DAYS.items():
        d = last_commit_date(path)
        if d is None:
            missing.append(path)
            continue
        age = (today - d).days
        if age > limit:
            stale.append({"file": path, "age_days": age, "limit": limit})

    for row in stale:
        print(f"STALE  {row['file']:<34} {row['age_days']:>4}d old (limit {row['limit']}d)")
    for path in missing:
        print(f"MISSING {path}")
    if not stale and not missing:
        print(f"snapshots OK: {len(MAX_AGE_DAYS)} files inside their window")

    if "--json" in sys.argv:
        out = sys.argv[sys.argv.index("--json") + 1]
        with open(out, "w") as fh:
            json.dump({"checked_at": today.isoformat(), "stale": stale, "missing": missing}, fh, indent=2)

    return 1 if stale or missing else 0


if __name__ == "__main__":
    sys.exit(main())
