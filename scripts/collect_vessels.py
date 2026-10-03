#!/usr/bin/env python3
r"""collect_vessels.py - AIS vessel positions over Hong Kong into a static JSON.

WHY A COLLECTOR AND NOT A FETCH. VesselAPI needs a server-side key, so the
front end cannot call it directly; the collector polls the bbox query and
writes data/vessels.json, which the front end reads through the live-data
branch (the aircraft pattern). aisstream.io — the only free WebSocket AIS —
went silent 2026-08 and blocks datacenter egress, so VesselAPI (REST) is the
fallback.

WHY 6 HOURS. Ships move far slower than aircraft. 6h = 120 calls/month, well
inside the 150-call free tier, with headroom for a 31-day month.

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
BBOX = "filter.latBottom=22.05&filter.latTop=22.65&filter.lonLeft=113.70&filter.lonRight=114.55"


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

    # One bbox query should cover HK waters in a single page; follow nextToken
    # up to a cap so a paginated answer still flattens into one file.
    all_vessels = []
    token = None
    try:
        for _ in range(5):
            url = f"{BASE}?{BBOX}" + (f"&nextToken={token}" if token else "")
            payload = get(url, KEY)
            all_vessels.extend(payload.get("vessels") or [])
            token = payload.get("nextToken")
            if not token:
                break
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
    print(f"OK   {os.path.basename(OUT)}  {len(body.encode('utf-8')):,} bytes  "
          f"{len(with_pos)} vessels with a position")
    return 0


if __name__ == "__main__":
    sys.exit(main())
