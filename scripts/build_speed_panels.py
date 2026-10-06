#!/usr/bin/env python3
"""build_speed_panels.py - The five 2nd-generation speed map panels as a point file.

WHY THIS EXISTS: the "speed map panels v2" dataset on DATA.GOV.HK is IMAGES, not
text notifications — the panel's live display is a PNG per location
(http://resource.data.one.gov.hk/td/jss/sj1.en.png etc). The locations CSV
carries the image URLs plus WGS84 coordinates; we snapshot the locations (the
IMAGE content changes server-side, the URLs do not) so the app can render a
live wall of the five boards.

The URL is https (http mixed-content is blocked in the browser), and the panel
adapter appends a ?t= cache-buster so each re-render fetches the current panel
display.

Usage:  python3 scripts/build_speed_panels.py [--check]
"""
import json
import sys
import urllib.request

UA = "Mozilla/5.0 (compatible; HKCityMonitor/1.0)"
URL = "https://static.data.gov.hk/td/speed-map-panels-v2/info/Speed_Map_Panel_Locations_en.csv"
OUT = "data/speed_panels.geojson"

def build() -> list[dict]:
    req = urllib.request.Request(URL, headers={"User-Agent": UA})
    csv = urllib.request.urlopen(req, timeout=60).read().decode("utf-8-sig")
    lines = [l for l in csv.strip().splitlines() if l.strip()]
    features = []
    for row in lines[1:]:
        cols = [c.strip() for c in row.split(",")]
        if len(cols) < 6:
            continue
        img_en, desc, _, _, lon, lat = cols[:6]
        pid = img_en.rstrip("/").split("/")[-1].split(".")[0]  # sj1
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
            "properties": {
                "id": pid,
                "name_en": desc,
                "url_en": img_en.replace("http://", "https://"),
                "url_tc": img_en.replace(".en.png", ".tc.png").replace("http://", "https://"),
                "url_sc": img_en.replace(".en.png", ".sc.png").replace("http://", "https://"),
            },
        })
    return features

def main() -> None:
    features = build()
    assert len(features) == 5, f"expected 5 panels, got {len(features)}"
    for f in features:
        assert f["geometry"]["coordinates"][0] > 113 and f["geometry"]["coordinates"][1] > 22, f["properties"]["id"]
        assert f["properties"]["url_tc"].startswith("https://"), f["properties"]["url_tc"]
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh, ensure_ascii=False, indent=1)
    if "--check" in sys.argv:
        print(f"speed panels: {len(features)} boards, coordinates + https image URLs ✓")
        for f in features:
            print(f"  {f['properties']['id']}: {f['properties']['name_en']}")

if __name__ == "__main__":
    main()
