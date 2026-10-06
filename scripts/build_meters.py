#!/usr/bin/env python3
"""build_meters.py — on-street parking SPACE positions (TD psi parking spaces).

Reads the official space-info CSV (every metered space with a sensor: id, street,
district, coordinates) and writes data/parking_meters.geojson. The occupancy feed
(occupancystatus.csv) shares ParkingSpaceId, so the adapter joins these positions
to live O/V status; this file is positions only, as-issued.
"""
import csv
import json
import urllib.request
import sys

URL = "https://resource.data.one.gov.hk/td/psiparkingspaces/spaceinfo/parkingspaces.csv"
OUT = "data/parking_meters.geojson"

req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (compatible; HKCityMonitor/1.0)"})
raw = urllib.request.urlopen(req, timeout=60).read().decode("utf-8-sig")
lines = raw.splitlines()
# The file opens with a publish-date line, a blank row, then the header. Skip
# until the actual header (first cell = PoleId) so DictReader sees real columns.
start = next(i for i, ln in enumerate(lines) if ln.strip().startswith("PoleId"))
rows = list(csv.DictReader(lines[start:]))

feats = []
seen = 0
for r in rows:
    sid = (r.get("ParkingSpaceId") or "").strip()
    lat = r.get("Latitude") or ""
    lon = r.get("Longitude") or ""
    if not sid or not lat or not lon:
        continue
    try:
        la, lo = float(lat), float(lon)
    except ValueError:
        continue
    seen += 1
    feats.append({
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lo, la]},
        "properties": {
            "id": sid,
            "street": r.get("Street_tc") or r.get("Street") or "",
            "district": r.get("District_tc") or r.get("District") or "",
            "vehicle_type": r.get("VehicleType") or "",
        },
    })

fc = {"type": "FeatureCollection", "features": feats}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(fc, f, ensure_ascii=False)
print(f"build_meters: {seen} spaces -> {OUT}")

if __name__ == "__main__":
    sys.exit(0)
