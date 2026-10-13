"""fetch_roads_overpass.py — can we get HK road geometry, and how big is it really?

Measure, do not estimate: downloads every drivable highway way in the HK bounding box
and prints the bytes. Output is cached at /tmp/hk_roads_osm.json so a re-run is free.

Usage: python3 scripts/fetch_roads_overpass.py [--keep]
"""
import json
import sys
import time
import urllib.parse
import urllib.request

CACHE = "/tmp/hk_roads_osm.json"
BBOX = "22.13,113.82,22.58,114.45"  # Hong Kong, generously boxed
CLASSES = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service"
QUERY = f"""[out:json][timeout:300];
way["highway"~"^({CLASSES})$"]({BBOX});
out geom;
"""


def main() -> None:
    try:
        with open(CACHE, encoding="utf-8") as f:
            body = f.read()
        print(f"cached: {CACHE}")
    except FileNotFoundError:
        req = urllib.request.Request(
            "https://overpass-api.de/api/interpreter",
            data=urllib.parse.urlencode({"data": QUERY}).encode(),
            headers={"User-Agent": "Mozilla/5.0 (compatible; HKCityMonitor/1.0)"},
        )
        t0 = time.time()
        body = urllib.request.urlopen(req, timeout=300).read().decode("utf-8")
        print(f"downloaded in {time.time() - t0:.0f}s")
        with open(CACHE, "w", encoding="utf-8") as f:
            f.write(body)

    mb = len(body.encode()) / 1048576
    d = json.loads(body)
    ways = d.get("elements", [])
    coords = sum(len(w.get("geometry") or []) for w in ways)
    print(f"OSM JSON as downloaded: {mb:.1f} MB, {len(ways)} ways, {coords} vertices")

    # The shape we would actually keep for a bearing lookup: segment endpoints only.
    feats = []
    for w in ways:
        geom = w.get("geometry") or []
        if len(geom) < 2:
            continue
        feats.append({
            "type": "Feature",
            "properties": {
                "id": w.get("id"),
                "name": (w.get("tags") or {}).get("name") or (w.get("tags") or {}).get("name:zh") or "",
                "highway": (w.get("tags") or {}).get("highway"),
            },
            "geometry": {"type": "LineString",
                         "coordinates": [[round(p["lon"], 6), round(p["lat"], 6)] for p in geom]},
        })
    gjson = json.dumps({"type": "FeatureCollection", "features": feats},
                       ensure_ascii=False, separators=(",", ":"))
    print(f"GeoJSON linework: {len(gjson.encode()) / 1048576:.1f} MB raw, "
          f"{len(__import__('gzip').compress(gjson.encode(), 6)) / 1048576:.1f} MB gzipped, {len(feats)} ways")
    named = sum(1 for f in feats if f["properties"]["name"])
    print(f"  {named} named ways ({100 * named / max(len(feats), 1):.0f}%) — enough to match a street name where it helps")
    print(f"  OpenStreetMap data (c) OpenStreetMap contributors, ODbL")
    if "--keep" in sys.argv:
        with open("/tmp/hk_roads.geojson", "w", encoding="utf-8") as f:
            f.write(gjson)
        print("wrote /tmp/hk_roads.geojson")


if __name__ == "__main__":
    main()
