#!/usr/bin/env python3
"""build_ai_cctv.py — TD AI Video Analytics CCTV locations.

CSDI td_rcd_1671693527354_28926 = "Traffic data from AI Video Analytics System
of CCTVs": 16 CCTV points (official geometry) whose `url` field is the live
JSON endpoint (td2132022opendata.td.gov.hk/{key}) returning per-segment
speed/flow, refreshed every 15 minutes. Positions are static as-issued; the
live numbers are never baked here.

Usage:  python3 scripts/build_ai_cctv.py [--check]
"""
import json
import sys
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (compatible; HKCityMonitor/1.0)"
DSID = "td_rcd_1671693527354_28926"
LAYER = "Traffic_Data_from_AI_Video_Analytics_System_of_CCTVs"
OUT = "data/ai_cctv.geojson"


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
                "key": p.get("key_"),
                "region": p.get("region"),
                "district": p.get("district"),
                "description": p.get("description"),
                "url": p.get("url"),
            },
        })
    return features


def main() -> None:
    features = build()
    assert len(features) >= 15, f"expected 16 AI CCTV, got {len(features)}"
    for f in features:
        lon, lat = f["geometry"]["coordinates"]
        assert 113.8 < lon < 114.5 and 22.2 < lat < 22.6, (lon, lat)
        assert str(f["properties"]["url"]).startswith("https://td2132022opendata.td.gov.hk/"), f["properties"]["url"]
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh, ensure_ascii=False, indent=1)
    if "--check" in sys.argv:
        print(f"AI 影像分析閉路電視: {len(features)} 部")


if __name__ == "__main__":
    main()
