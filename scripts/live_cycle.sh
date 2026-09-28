#!/bin/sh
# live_cycle.sh — one pass: collect the live files, then publish them to `live-data`.
#
# WHY ONE PASS AND NOT A CRON PER COLLECTOR. The three files share a single publish
# step, and a publish that runs before its collector has written anything just
# re-pushes the previous reading — work that looks like freshness. One pass keeps the
# published set and the collected set the same age.
#
# WHERE THIS CAN RUN. Any host that (a) can reach the upstreams and (b) has a push
# credential for the repo. MEASURED 2026-09-28: the VPS is both — opendata.adsb.fi
# answers 200 from there (it blocks Cloudflare's edge, not a server), and the VPS
# holds the repo's push key. The PC could collect but not authenticate, which is what
# left every reading sitting in a working copy that nothing published. Point
# HKCM_REMOTE at the URL the host can actually push to.
#
# A FAILED COLLECTOR DOES NOT ABORT THE CYCLE. Each collector writes atomically and
# refuses to clobber a good file with an empty one, so the honest outcome is: publish
# what is current, then exit non-zero so the schedule reports a failure. Publishing
# nothing would look exactly like a quiet feed, which is the failure mode this whole
# file exists to avoid.
#
# Usage:  sh scripts/live_cycle.sh
set -u

DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$DIR" || exit 1
PY=${PYTHON:-python3}
FILES="data/aircraft.json data/berth_vacancy.json data/water_suspension.json"
rc=0

for c in collect_aircraft collect_berths build_water_suspension; do
  if ! "$PY" "scripts/$c.py"; then
    echo "FAIL $c — it kept its previous file; publishing it anyway, its own timestamp says how old it is"
    rc=1
  fi
done

# shellcheck disable=SC2086 # FILES is a deliberate word-split list of paths
if ! "$PY" scripts/publish_live.py $FILES; then
  echo "FAIL publish_live.py — nothing new reached the browser"
  rc=1
fi

exit $rc
