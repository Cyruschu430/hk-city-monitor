#!/usr/bin/env python3
r"""collect_berths.py - live berth vacancy at Hong Kong's public cargo working areas.

WHY THIS IS ITS OWN FILE AND NOT PART OF build_facilities.py. build_facilities.py builds a STATIC
reference layer: where the cargo working areas are, which does not change. This one carries the
`Vacant` flag, which changes hour to hour. Baking a live flag into a committed static snapshot is a
stale number presented as current - the one thing this project must not do - so the live field gets
its own file, its own cadence and its own timestamp on every feature.

MEASURED 2026-09-27: MARDEP mardep_rcd_1638859086572_29125 returns 120 berths as polygons, each with
berth_id (e.g. WD-01) and Vacant (Y/N). 120 berths is small enough that no slimming is needed.

The berth id is the popup head because that is what the publisher calls it; the vacancy is a labelled
row. Inventing a friendlier name for WD-01 would be inventing a place name.

Usage:  py collect_berths.py
"""
import json, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "berth_vacancy.json")
SVC = ("https://portal.csdi.gov.hk/server/rest/services/common/"
       "mardep_rcd_1638859086572_29125/FeatureServer/0/query")
UA = "HKCityMonitor/1.0 (+https://github.com/Cyruschu430/hk-city-monitor)"
HK = timezone(timedelta(hours=8))


def main():
    url = SVC + "?" + urllib.parse.urlencode(
        {"where": "1=1", "outFields": "berth_id,Vacant", "returnGeometry": "true",
         "f": "geojson", "outSR": "4326"})
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=90) as r:
            gj = json.loads(r.read().decode("utf-8"))
    except Exception as exc:                                     # noqa: BLE001 - reported below
        print(f"FAIL {exc}", file=sys.stderr)
        print(f"FAIL kept the previous {os.path.basename(OUT)} — a blank harbour is not an update",
              file=sys.stderr)
        return 1

    now = datetime.now(HK)
    stamp = now.strftime("%Y-%m-%d %H:%M")
    feats, vacant, occupied = [], 0, 0
    for f in gj.get("features", []):
        p = f.get("properties") or {}
        if not f.get("geometry"):
            continue
        is_vacant = str(p.get("Vacant", "")).strip().upper() == "Y"
        vacant += is_vacant
        occupied += (not is_vacant)
        feats.append({"type": "Feature", "geometry": f["geometry"], "properties": {
            "Name": str(p.get("berth_id") or "?"),
            "Vacancy_tc": "空置" if is_vacant else "使用中",
            "Vacancy_en": "Vacant" if is_vacant else "In use",
            # On EVERY feature, not just in a file header: a popup is where a reader looks, and a
            # reader who opened a popup should not have to trust that the file is fresh.
            "LastUpdate": stamp,
        }})
    if not feats:
        print("FAIL 0 berths returned", file=sys.stderr)
        return 1

    body = json.dumps({"type": "FeatureCollection",
                       "_comment": ("Live berth vacancy, public cargo working areas (MARDEP via CSDI). "
                                    "scripts/collect_berths.py — do not hand-edit."),
                       "features": feats},
                      ensure_ascii=False, separators=(",", ":"))
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(body)
    os.replace(tmp, OUT)
    print(f"OK   {os.path.basename(OUT)}  {len(body.encode('utf-8')):,} bytes  "
          f"{len(feats)} berths  vacant={vacant} in_use={occupied}  as at {stamp} HKT")
    return 0


if __name__ == "__main__":
    sys.exit(main())
