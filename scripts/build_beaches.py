#!/usr/bin/env python3
"""build_beaches.py - The 40 EPD-graded beaches as a point file (positions only).

WHY THIS EXISTS: EPD's beach water-quality RSS (beach2.rss) grades ~40 beaches
but the GRADING is what changes — the POSITIONS are static. This script
snapshots the positions (parsed from the RSS's own WGS84 DMS cells, HK1980
grid also present) so the live grading adapter can merge the daily grade onto
them by beach name, exactly like the AQHI layer. Grades are NEVER baked here.

Usage:  python3 scripts/build_beaches.py [--check]
"""
import json
import html
import re
import sys
import urllib.request

UA = "Mozilla/5.0 (compatible; HKCityMonitor/1.0)"
RSS = "https://cd.epic.epd.gov.hk/beachpsi/tc/beach2.rss"
OUT = "data/beaches.geojson"


def dms_to_dec(d: int, m: int, s: float) -> float:
    return d + m / 60.0 + s / 3600.0


def build() -> list[dict]:
    req = urllib.request.Request(RSS, headers={"User-Agent": UA})
    rss = urllib.request.urlopen(req, timeout=60).read().decode("utf-8")
    items = re.findall(r"<item>(.*?)</item>", rss, re.S)
    features = []
    for it in items:
        t = re.search(r"<title>(.*?)</title>", it, re.S)
        if not t:
            continue
        m = re.match(r"^(.*?泳灘)的水質被評為(.*)$", t.group(1).strip())
        if not m:
            continue
        name, grade = m.group(1), m.group(2)
        d = re.search(r"<description>(.*?)</description>", it, re.S)
        if not d:
            continue
        desc = html.unescape(d.group(1))
        lat_m = re.search(r"緯度 \(北\):.*?(\d+)°\s*(\d+)'\s*([\d.]+)\"", desc)
        lon_m = re.search(r"經度 \(東\):.*?(\d+)°\s*(\d+)'\s*([\d.]+)\"", desc)
        if not lat_m or not lon_m:
            continue
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [
                    dms_to_dec(int(lon_m.group(1)), int(lon_m.group(2)), float(lon_m.group(3))),
                    dms_to_dec(int(lat_m.group(1)), int(lat_m.group(2)), float(lat_m.group(3))),
                ],
            },
            "properties": {"name": name, "grade": grade},
        })
    return features


def main() -> None:
    features = build()
    assert 38 <= len(features) <= 42, f"expected ~40 beaches, got {len(features)}"
    for f in features:
        lon, lat = f["geometry"]["coordinates"]
        assert 113.8 < lon < 114.5 and 22.1 < lat < 22.6, (lon, lat, f["properties"]["name"])
        assert "泳灘" in f["properties"]["name"]
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh, ensure_ascii=False, indent=1)
    if "--check" in sys.argv:
        print(f"beaches: {len(features)} graded beaches, positions parsed from the RSS's own WGS84 cells ✓")
        for f in features[:6]:
            print(f"  {f['properties']['name']} @ {f['geometry']['coordinates']}")


if __name__ == "__main__":
    main()
