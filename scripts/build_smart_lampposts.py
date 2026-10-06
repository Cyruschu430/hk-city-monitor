#!/usr/bin/env python3
"""build_smart_lampposts.py - EPD smart lamppost air-quality stations as a point file.

WHY THIS EXISTS: CSDI's "Smart Lamppost Air Quality Data" (epd_rcd_1631501732991_89126)
lists the 11 lampposts that host EPD air-quality sensors — official geometry,
district, the measured species (NO / NO2 / PM2.5) and a per-lamppost live API
(LamppostAPI). The positions are snapshot here (reference geometry, like the
weather-station layer); the per-lamppost readings API is NOT wired in because
it returned no records at the documented shape on 2026-10-06 (pi=DF3651&di=01
→ "No record found" for every di tried) — a layer claiming live values would
lie. The panel says WHERE they are and WHAT they measure; the live readings
stay behind the public paqs.epd-asmg.gov.hk site.

Usage:  python3 scripts/build_smart_lampposts.py [--check]
"""
import json
import sys
import urllib.request

UA = "Mozilla/5.0 (compatible; HKCityMonitor/1.0)"
CSDI = (
    "https://portal.csdi.gov.hk/server/rest/services/common/"
    "epd_rcd_1631501732991_89126/FeatureServer/0/query"
)
OUT = "data/smart_lampposts.geojson"

def build() -> list[dict]:
    params = "?f=geojson&outSR=4326&resultRecordCount=100&outFields=*&where=1%3D1"
    req = urllib.request.Request(CSDI + params, headers={"User-Agent": UA})
    fc = json.loads(urllib.request.urlopen(req, timeout=90).read().decode("utf-8"))
    features = []
    for f in fc.get("features", []):
        p = f.get("properties", {})
        measures = str(p.get("DataTypeCollected", "")).replace('"', "").replace(",", " / ")
        features.append({
            "type": "Feature",
            "geometry": f.get("geometry"),
            "properties": {
                "id": str(p.get("LamppostID", "")),
                "location_tc": str(p.get("location_tc", "")),
                "location_en": str(p.get("location_en", "")),
                "district_tc": str(p.get("district_tc", "")),
                "district_en": str(p.get("district_en", "")),
                "measures": measures,
                "website": str(p.get("LamppostWebsite", "")),
            },
        })
    return features

def main() -> None:
    features = build()
    assert 10 <= len(features) <= 12, f"expected ~11 lampposts, got {len(features)}"
    for f in features:
        g = f["geometry"]
        assert g and g.get("type") == "Point", f["properties"]["id"]
        assert f["properties"]["location_tc"], f["properties"]["id"]
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh, ensure_ascii=False, indent=1)
    if "--check" in sys.argv:
        print(f"smart lampposts: {len(features)} AQ stations")
        for f in features:
            print(f"  {f['properties']['id']}: {f['properties']['location_tc']} ({f['properties']['district_tc']}) — {f['properties']['measures']}")

if __name__ == "__main__":
    main()
