#!/bin/sh
# snapshot_cycle.sh — refresh the SLOW-cadence reference snapshots, publish only what changed.
#
# WHY THIS IS SEPARATE FROM live_cycle.sh. live_cycle.sh runs every ten minutes and owns the
# files whose values change minute to minute (aircraft, berths, water notices). These are the
# other kind: bus route topology, LCSD venues, parking meters, EV chargers, hiking trails. They
# change daily-to-monthly, and until this existed they only changed when somebody ran the builder
# by hand and deployed — which is why a panel could be right on the day it shipped and quietly
# wrong a fortnight later.
#
# WHY ONLY CHANGED FILES ARE PUBLISHED. publish_live.py force-pushes one orphan commit. Pushing
# eight unchanged multi-megabyte files every day would leave unreachable objects behind on every
# run for no gain. A clean checkout before the builders run means `git status` names exactly the
# files whose bytes moved, so that is the publish set. Nothing changed: nothing pushed.
#
# A FAILED BUILDER DOES NOT ABORT THE CYCLE. Each builder writes atomically and keeps its previous
# file when the upstream is unreachable, and every published file carries the publisher's own
# timestamp, so a stale copy reads as stale rather than as current.
#
# Usage:  sh scripts/snapshot_cycle.sh
set -u

DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$DIR" || exit 1
PY=${PYTHON:-python3}
rc=0

for c in build_bus_data build_lcsd build_meters build_carpark_info build_hiking_trails \
         build_ev_chargers build_aed build_smartplay; do
  if ! "$PY" "scripts/$c.py"; then
    echo "FAIL $c — it kept its previous file; the published copy keeps its own timestamp"
    rc=1
  fi
done

CHANGED=$(git status --porcelain data/ | awk '{print $2}' | grep -E '\.(json|geojson)$' || true)
if [ -z "$CHANGED" ]; then
  echo "no snapshot changed; nothing to publish"
  exit $rc
fi

echo "publishing:" $CHANGED
# shellcheck disable=SC2086 # CHANGED is a deliberate word-split list of paths
if ! "$PY" scripts/publish_live.py $CHANGED; then
  echo "FAIL publish_live.py — the browser keeps reading the previous snapshot"
  rc=1
fi

exit $rc
