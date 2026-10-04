#!/usr/bin/env python3
r"""collect_vessels.py - AIS vessel positions over Hong Kong into a static JSON.

WHY A COLLECTOR AND NOT A FETCH. VesselAPI needs a server-side key, so the
front end cannot call it directly; the collector polls the bbox query and
writes data/vessels.json, which the front end reads through the live-data
branch (the aircraft pattern). aisstream.io — the only free WebSocket AIS —
went silent 2026-08 and blocks datacenter egress, so VesselAPI (REST) is the
fallback.

WHY 12 HOURS. Ships move far slower than aircraft. 2 pages x 2 runs a day =
~124 calls/month inside the 150-call free tier, with headroom for a 31-day month.
A page cannot exceed 50 rows, so coverage past 50 is pages, not a bigger page.

A FAILED RUN MUST NOT DESTROY A GOOD FILE. A refused key, a network error or
zero position reports leave the previous file untouched and exit non-zero, so
the schedule reports a failure instead of the map quietly going blank.

Env: VESSELAPI_KEY. Out: data/vessels.json
"""
import json, os, sys, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "vessels.json")
UA = "HKCityMonitor/1.0 (+https://github.com/Cyruschu430/hk-city-monitor)"
KEY = os.environ.get("VESSELAPI_KEY", "").strip()
# Hong Kong waters with margin: harbour, approaches, Pearl River estuary mouth.
# VesselAPI bbox params: latBottom/latTop/lonLeft/lonRight.
BASE = "https://api.vesselapi.com/v1/location/vessels/bounding-box"
# 50 is VesselAPI's hard cap. A larger limit is not clamped, it is refused with
# HTTP 400 invalid_parameter, which killed every scheduled run between 2026-10-03
# and 2026-10-04 — coverage past 50 comes from the nextToken loop below, not from
# a bigger page. Do not raise this number.
BBOX = "filter.latBottom=22.05&filter.latTop=22.65&filter.lonLeft=113.70&filter.lonRight=114.55&pagination.limit=50"


def get(url, key):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Authorization": "Bearer " + key,
    })
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    if not KEY:
        print("FAIL no VESSELAPI_KEY in the environment", file=sys.stderr)
        print("FAIL kept the previous vessels.json — an empty map is not an update", file=sys.stderr)
        return 1

    # Pages per run and runs per month have to multiply to under the free tier's
    # 150 calls: 2 pages x 2 runs a day = ~124 calls in a 31-day month. A single
    # 50-row page was not enough once the cap forced the page size down from 100,
    # so the honest trade is a slower cadence for full coverage — ships move far
    # slower than aircraft, which is why 12 hours is fine here.
    MAX_PAGES = 2
    all_vessels = []
    token = None
    truncated = False
    try:
        for _ in range(MAX_PAGES):
            url = f"{BASE}?{BBOX}" + (f"&pagination.nextToken={token}" if token else "")
            payload = get(url, KEY)
            all_vessels.extend(payload.get("vessels") or [])
            token = payload.get("nextToken")
            if not token:
                break
            truncated = True                 # more pages exist than we are allowed
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        print(f"FAIL HTTP {exc.code} {exc.reason}: {body[:600]}", file=sys.stderr)
        print("FAIL kept the previous vessels.json", file=sys.stderr)
        return 1
    except Exception as exc:                                     # noqa: BLE001 - reported below
        print(f"FAIL {exc}", file=sys.stderr)
        print("FAIL kept the previous vessels.json", file=sys.stderr)
        return 1

    with_pos = [v for v in all_vessels
                if v.get("latitude") is not None and v.get("longitude") is not None]
    if not with_pos:
        print("FAIL 0 vessels with a position — kept the previous file", file=sys.stderr)
        return 1

    body = json.dumps({"vessels": with_pos}, ensure_ascii=False, separators=(",", ":"))
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(body)
    os.replace(tmp, OUT)                                         # atomic
    if truncated:
        # Loud on purpose: a silent truncation looks exactly like a quiet harbour.
        print(f"WARN hit the {MAX_PAGES}-page cap with more vessels pending — "
              f"coverage is truncated, raise MAX_PAGES and slow the schedule together",
              file=sys.stderr)
    print(f"OK   {os.path.basename(OUT)}  {len(body.encode('utf-8')):,} bytes  "
          f"{len(with_pos)} vessels with a position")
    return 0


if __name__ == "__main__":
    sys.exit(main())
