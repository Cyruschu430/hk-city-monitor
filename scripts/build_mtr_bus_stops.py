#!/usr/bin/env python3
"""build_mtr_bus_stops.py - MTR feeder-bus stops as a point file.

WHY THIS EXISTS: opendata.mtr.com.hk/mtr_bus_stops.csv lists all 855 feeder-bus
stops with WGS84 coordinates and the STATION_ID that the live getSchedule API
returns as busStopId — so the live ETA adapter can join by that id with zero
name-matching. Positions are static (as-issued); ETAs are never baked here.

Usage:  python3 scripts/build_mtr_bus_stops.py [--check]
"""
import csv
import json
import sys
import urllib.request

UA = "Mozilla/5.0 (compatible; HKCityMonitor/1.0)"
CSV_URL = "https://opendata.mtr.com.hk/data/mtr_bus_stops.csv"
OUT = "data/mtr_bus_stops.geojson"


def build() -> list[dict]:
    req = urllib.request.Request(CSV_URL, headers={"User-Agent": UA})
    text = urllib.request.urlopen(req, timeout=60).read().decode("utf-8-sig")
    rows = [r for r in csv.DictReader(text.splitlines()) if r.get("STATION_ID")]
    features = []
    for r in rows:
        try:
            lat = float(r["STATION_LATITUDE"])
            lon = float(r["STATION_LONGITUDE"])
        except (TypeError, ValueError):
            continue
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "station_id": r["STATION_ID"],
                "route": r["ROUTE_ID"],
                "dir": r["DIRECTION"],
                "seq": int(r["STATION_SEQNO"] or 0),
                "name_tc": r["STATION_NAME_CHI"],
                "name_en": r["STATION_NAME_ENG"],
                "ref": r["REFERENCE_ID"],
            },
        })
    return features


def main() -> None:
    features = build()
    assert len(features) >= 800, f"expected ~855 stops, got {len(features)}"
    routes = sorted({f["properties"]["route"] for f in features})
    for f in features:
        lon, lat = f["geometry"]["coordinates"]
        assert 113.7 < lon < 114.6 and 22.2 < lat < 22.6, (lon, lat, f["properties"]["name_tc"])
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh, ensure_ascii=False, indent=1)
    if "--check" in sys.argv:
        print(f"MTR 接駁巴士站: {len(features)} 站 / {len(routes)} 路線")
        print("路線:", ", ".join(routes))


if __name__ == "__main__":
    main()
