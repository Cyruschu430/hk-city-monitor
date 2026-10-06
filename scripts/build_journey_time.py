#!/usr/bin/env python3
"""build_journey_time.py — Journey Time Indicators (2nd Gen) locations.

CSDI td_rcd_1671692669689_59165 gives the 80 indicator locations (approach
roads to tunnels / major corridors) as WGS84 points, each tagged with the
location_id + destination_id that the live XML (Journeytimev2.xml) also
carries — so the adapter joins by id with zero name matching.

Usage:  python3 scripts/build_journey_time.py [--check]
"""
import json
import sys
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (compatible; HKCityMonitor/1.0)"
DSID = "td_rcd_1671692669689_59165"
LAYER = "Locations_of_Journey_Time_Indicators"
OUT = "data/journey_time_locations.geojson"


def build() -> list[dict]:
    q = urllib.parse.urlencode({"dataset_id": DSID, "format": "geojson", "layer_name": LAYER})
    req = urllib.request.Request(f"https://portal.csdi.gov.hk/csdi-webpage/file-api?{q}", headers={"User-Agent": UA})
    fc = json.load(urllib.request.urlopen(req, timeout=90))
    features = []
    for f in fc.get("features", []):
        p = f.get("properties", {})
        features.append({
            "type": "Feature",
            "geometry": f["geometry"],
            "properties": {
                "location_id": p.get("location_id"),
                "destination_id": p.get("destination_id"),
                "name_tc": p.get("location_name_tc") or p.get("location_name_en"),
                "name_en": p.get("location_name_en"),
                "dest_tc": p.get("destination_name_tc"),
                "dest_en": p.get("destination_name_en"),
                "key": f'{p.get("location_id")}|{p.get("destination_id")}',
            },
        })
    return features


def main() -> None:
    features = build()
    assert len(features) >= 70, f"expected ~80 locations, got {len(features)}"
    keys = {f["properties"]["key"] for f in features}
    assert len(keys) == len(features), "duplicate location|destination keys"
    for f in features:
        lon, lat = f["geometry"]["coordinates"]
        assert 113.8 < lon < 114.5 and 22.2 < lat < 22.6, (lon, lat)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh, ensure_ascii=False, indent=1)
    if "--check" in sys.argv:
        tunnels = [f for f in features if f["properties"]["destination_id"] in ("CH", "EH", "WH")]
        print(f"行車時間指示點: {len(features)} 個位置 / 隧道去向 {len(tunnels)} 條")


if __name__ == "__main__":
    main()
