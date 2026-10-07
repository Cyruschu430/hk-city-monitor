#!/usr/bin/env python3
"""build_parking_grid.py — parking spaces aggregated to a grid for the map layer."""
import json

with open("data/parking_meters.geojson", encoding="utf-8") as f:
    data = json.load(f)

# Simple grid: round lat/lng to 0.001° (~100m)
grid = {}
for feat in data["features"]:
    props = feat["properties"]
    coords = feat["geometry"]["coordinates"]
    key = (round(coords[1], 3), round(coords[0], 3))
    if key not in grid:
        grid[key] = {"lat": key[0], "lng": key[1], "ids": [], "streets": set()}
    grid[key]["ids"].append(props["id"])
    grid[key]["streets"].add(props.get("street", ""))

out = []
for g in grid.values():
    out.append({
        "lat": g["lat"],
        "lng": g["lng"],
        "count": len(g["ids"]),
        "street": "、".join(sorted(g["streets"]))[:50],
    })

out.sort(key=lambda x: -x["count"])
with open("data/parking_grid.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(f"parking grid: {len(out)} cells -> data/parking_grid.json ({len(json.dumps(out)) // 1024}KB)")
