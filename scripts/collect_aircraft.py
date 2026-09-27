#!/usr/bin/env python3
r"""collect_aircraft.py - live ADS-B traffic over Hong Kong into a static JSON.

WHY A COLLECTOR AND NOT A FETCH. api.adsb.lol blocks cloud egress, so the deployed Worker
cannot reach it - MEASURED: 403 from the VPS/Cloudflare, 200 from this PC. The front end
therefore cannot call it directly, and the source is a static file this PC publishes
(the water-suspension and AED pattern).

WHY THE RESPONSE IS STORED VERBATIM. parseAdsb() in lib/parsers.ts already reads exactly
this shape - {ac:[{hex,flight,r,t,alt_baro,gs,track,lat,lon,squawk,...}], now} - and the
`now` field is what makes the payload age correctly in the UI. Re-shaping it here would
mean writing a second parser and keeping two of them in step for no gain:
MEASURED 2026-09-27, a 100nm radius around Hong Kong returns 27 aircraft in 16,254 bytes.
There is nothing to slim at 16KB.

A FAILED RUN MUST NOT DESTROY A GOOD FILE. If both mirrors fail or return zero aircraft
the existing file is left untouched and the exit code is non-zero, so the scheduled task
reports a failure instead of the app quietly showing an empty sky. An empty sky and a
dead collector look identical to a reader otherwise.

Usage:  py collect_aircraft.py            # write data/aircraft.json
"""
import json, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "aircraft.json")
UA = "HKCityMonitor/1.0 (+https://github.com/Cyruschu430/hk-city-monitor)"
# Both are community ADS-B mirrors. adsb.lol's data is ODbL 1.0, which permits commercial
# use - unlike OpenSky, whose terms forbid "operational use of the REST API in any live
# product". adsb.fi is the fallback for the same reason a second mirror exists at all:
# one community host going down should not blank the layer.
MIRRORS = [
    "https://api.adsb.lol/v2/point/22.32/114.17/100",
    "https://opendata.adsb.fi/api/v2/lat/22.32/lon/114.17/dist/100",
]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    errors = []
    for url in MIRRORS:
        try:
            payload = get(url)
        except Exception as exc:                                  # noqa: BLE001 - reported below
            errors.append(f"{url}: {exc}")
            continue
        ac = payload.get("ac") or []
        with_pos = [a for a in ac if a.get("lat") is not None and a.get("lon") is not None]
        if not with_pos:
            errors.append(f"{url}: 0 aircraft with a position")
            continue
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        tmp = OUT + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(body)
        os.replace(tmp, OUT)   # atomic: a reader never sees a half-written file
        print(f"OK   {os.path.basename(OUT)}  {len(body.encode('utf-8')):,} bytes  "
              f"{len(with_pos)} aircraft with a position  from {url.split('/')[2]}")
        return 0
    print("FAIL " + " | ".join(errors), file=sys.stderr)
    print(f"FAIL kept the previous {os.path.basename(OUT)} — a blank sky is not an update", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
