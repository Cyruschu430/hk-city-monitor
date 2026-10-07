#!/usr/bin/env python3
"""build_parking_lite.py — parking_meters.geojson → lite version for the map layer."""
import json

with open("data/parking_meters.geojson", encoding="utf-8") as f:
    data = json.load(f)

out = []
for feat in data["features"]:
    props = feat["properties"]
    coords = feat["geometry"]["coordinates"]
    out.append({
        "id": props["id"],
        "lat": coords[1],
        "lng": coords[0],
        "street": props.get("street", ""),
        "district": props.get("district", ""),
        "type": props.get("vehicle_type", ""),
    })

with open("data/parking_meters_lite.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(f"parking lite: {len(out)} spaces -> data/parking_meters_lite.json ({len(json.dumps(out)) // 1024}KB)")
