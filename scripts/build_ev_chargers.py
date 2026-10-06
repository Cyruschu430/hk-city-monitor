#!/usr/bin/env python3
"""build_ev_chargers.py — public EV chargers (CSDI epd_rcd_1631080339740_69941).

EPD "Electric Vehicle Chargers for Public Access": 988 locations with
per-type charger counts (standard BS1363 / medium / quick / fast). Positions
and counts are official; counts change slowly, the file is as-issued.

Usage:  python3 scripts/build_ev_chargers.py [--check]
"""
import json
import sys
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (compatible; HKCityMonitor/1.0)"
DSID = "epd_rcd_1631080339740_69941"
LAYER = "geotagging"
OUT = "data/ev_chargers.geojson"

MEDIUM_KEYS = [k for k in ("MEDIUM_CCS_DC_COMBO_no", "MEDIUM_IEC62196_no", "MEDIUM_SAEJ1772_no", "MEDIUM_GB_T20234_2_AC__no", "MEDIUM_OTHERS_no")]
QUICK_KEYS = [k for k in ("QUICK_CHAdeMO_no", "QUICK_CCS_DC_COMBO_no", "QUICK_IEC62196_no", "QUICK_GB_T20234_3_DC__no", "QUICK_OTHERS_no")]
FAST_KEYS = [k for k in ("FAST_CHAdeMO_no", "FAST_CCS_DC_COMBO_no", "FAST_IEC62196_no", "FAST_GB_T20234_3_DC__no", "FAST_OTHERS_no")]


def num(p: dict, k: str) -> int:
    try:
        return int(p.get(k) or 0)
    except (TypeError, ValueError):
        return 0


def build() -> list[dict]:
    q = urllib.parse.urlencode({"dataset_id": DSID, "format": "geojson", "layer_name": LAYER})
    req = urllib.request.Request(f"https://portal.csdi.gov.hk/csdi-webpage/file-api?{q}", headers={"User-Agent": UA})
    fc = json.load(urllib.request.urlopen(req, timeout=120))
    features = []
    for f in fc.get("features", []):
        p = f.get("properties", {})
        medium = sum(num(p, k) for k in MEDIUM_KEYS)
        quick = sum(num(p, k) for k in QUICK_KEYS)
        fast = sum(num(p, k) for k in FAST_KEYS)
        std = num(p, "STANDARD_BS1363_no")
        features.append({
            "type": "Feature",
            "geometry": f["geometry"],
            "properties": {
                "district_tc": p.get("NAME_OF_DISTRICT_COUNCIL_DISTRICT_TC"),
                "district_en": p.get("NAME_OF_DISTRICT_COUNCIL_DISTRICT_EN"),
                "location_tc": p.get("LOCATION_TC"),
                "location_en": p.get("LOCATION_EN"),
                "address_en": p.get("ADDRESS_EN"),
                "std": std,
                "medium": medium,
                "quick": quick,
                "fast": fast,
                "total": std + medium + quick + fast,
            },
        })
    return features


def main() -> None:
    features = build()
    assert len(features) >= 900, f"expected ~988 chargers, got {len(features)}"
    for f in features:
        lon, lat = f["geometry"]["coordinates"]
        assert 113.8 < lon < 114.5 and 22.2 < lat < 22.6, (lon, lat)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh, ensure_ascii=False, indent=1)
    if "--check" in sys.argv:
        tot = sum(f["properties"]["total"] for f in features)
        print(f"公眾充電站: {len(features)} 站 / 充電器 {tot} 個")


if __name__ == "__main__":
    main()
