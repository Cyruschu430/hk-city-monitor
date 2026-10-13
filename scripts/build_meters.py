#!/usr/bin/env python3
"""build_meters.py — on-street parking SPACE positions (TD psi parking spaces).

Reads the official space-info CSV (every metered space with a sensor: id, street,
district, coordinates) and writes data/parking_meters.geojson. The occupancy feed
(occupancystatus.csv) shares ParkingSpaceId, so the adapter joins these positions
to live O/V status; this file is positions only, as-issued.

Each space also gets a `bearing`: the direction the bay LIES ALONG, in degrees
clockwise from north, so a bay on an east-west street is drawn lying east-west
instead of every bay on the map standing upright.

How the bearing is derived, and why not the obvious ways:

  · Not the street's single direction. 香島道 is 4km of curves; one angle per
    street name would stand bays across their own kerb at both ends.
  · Not the nearest neighbouring space either. Two bays facing each other across a
    road are often each other's nearest neighbour, and that vector points ACROSS
    the street — the bay would be drawn 90° out.
  · So: the principal axis of each space's local cluster of the same street
    (neighbours within 50m, up to 8 of them). Points on both kerbs of a straight
    street are collinear along it, so the axis survives the two-sided case, and a
    cluster that is local survives the curve. Pure-python 2x2 PCA — no numpy.

A space with fewer than 3 neighbours has no axis to measure and keeps bearing 0
(upright); the count is printed, because "most of them" is not a thing to claim
silently.
"""
import csv
import json
import math
import sys
import urllib.request

URL = "https://resource.data.one.gov.hk/td/psiparkingspaces/spaceinfo/parkingspaces.csv"
OUT = "data/parking_meters.geojson"
NEIGHBOUR_RADIUS_M = 50.0
MAX_NEIGHBOURS = 8
MIN_FOR_AXIS = 3


def local_bearing(lat: float, lon: float, mates: list[tuple[float, float]]) -> float:
    """Principal axis of (lat, lon) + mates, clockwise from north, 0..180.

    0..180 rather than 0..360 because a rectangle is symmetric: the two ends of a
    bay are the same edge.
    """
    n = len(mates) + 1
    mlat = sum(p[0] for p in mates + [(lat, lon)]) / n
    mlon = sum(p[1] for p in mates + [(lat, lon)]) / n
    # Scale longitude to metres-equivalent so the axis is a real-world axis.
    k = math.cos(math.radians(lat))
    sxx = sxy = syy = 0.0
    for la, lo in mates + [(lat, lon)]:
        dx = (lo - mlon) * k
        dy = la - mlat
        sxx += dx * dx
        sxy += dx * dy
        syy += dy * dy
    if sxx == 0 and syy == 0:
        return 0.0
    # Angle of the principal eigenvector of [[sxx, sxy], [sxy, syy]].
    # atan2(2*sxy, sxx - syy)/2 gives the axis in the x-east/y-north frame.
    axis = 0.5 * math.atan2(2 * sxy, sxx - syy)
    bearing = math.degrees(math.atan2(math.sin(axis), math.cos(axis)))  # east-based
    # Convert the maths angle (from east, anticlockwise) to compass bearing.
    compass = (90.0 - bearing) % 180.0
    return round(compass, 1)


def self_check() -> None:
    """A synthetic east-west row of bays must come out ~90°, a north-south ~0°."""
    bays = [(22.30, 114.170 + i * 0.00005) for i in range(5)]  # east-west
    got = local_bearing(22.30, 114.170 + 0.0001, [b for b in bays if b[1] != 114.1701])
    assert abs(got - 90) < 2, f"east-west row gave {got}, want ~90"
    bays = [(22.30 + i * 0.00005, 114.170) for i in range(5)]  # north-south
    got = local_bearing(22.30, 114.170 + 0.0, [b for b in bays if b[0] != 22.30])
    assert abs(got) < 2 or abs(got - 180) < 2, f"north-south column gave {got}, want ~0"
    # One neighbour across the road (the case the naive version got wrong) must not
    # drag the axis across the street.
    across = local_bearing(22.30, 114.1700, [(22.30000, 114.17008), (22.30008, 114.16995), (22.30000, 114.16990)])
    assert abs(across - 90) < 25, f"two-sided cluster gave {across}, want nearer ~90 than ~0"
    print("self-check ok: east-west ~90°, north-south ~0°, two-sided cluster stays on the street axis")


def main() -> None:
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (compatible; HKCityMonitor/1.0)"})
    raw = urllib.request.urlopen(req, timeout=60).read().decode("utf-8-sig")
    lines = raw.splitlines()
    # The file opens with a publish-date line, a blank row, then the header. Skip
    # until the actual header (first cell = PoleId) so DictReader sees real columns.
    start = next(i for i, ln in enumerate(lines) if ln.strip().startswith("PoleId"))
    rows = list(csv.DictReader(lines[start:]))

    pts: list[dict] = []
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
        pts.append({
            "id": sid,
            "lat": la,
            "lon": lo,
            "street": r.get("Street_tc") or r.get("Street") or "",
            "district": r.get("District_tc") or r.get("District") or "",
            "vehicle_type": r.get("VehicleType") or "",
        })

    # Grid bucket by street + ~50m cell, so the neighbour search is not 20,712² .
    dlat = NEIGHBOUR_RADIUS_M / 111_320.0
    cell: dict[tuple[str, int, int], list[int]] = {}
    for i, p in enumerate(pts):
        key = (p["street"], int(p["lat"] / dlat), int(p["lon"] / (dlat / math.cos(math.radians(p["lat"])))))
        cell.setdefault(key, []).append(i)

    measured = 0
    fallback = 0
    for i, p in enumerate(pts):
        dlon = dlat / math.cos(math.radians(p["lat"]))
        mates: list[tuple[float, float]] = []
        cx = int(p["lon"] / dlon)
        cy = int(p["lat"] / dlat)
        for gx in (cx - 1, cx, cx + 1):
            for gy in (cy - 1, cy, cy + 1):
                for j in cell.get((p["street"], gy, gx), []):
                    if j == i:
                        continue
                    q = pts[j]
                    dy = (q["lat"] - p["lat"]) * 111_320.0
                    dx = (q["lon"] - p["lon"]) * 111_320.0 * math.cos(math.radians(p["lat"]))
                    if math.hypot(dx, dy) <= NEIGHBOUR_RADIUS_M:
                        mates.append((q["lat"], q["lon"]))
        mates.sort(key=lambda m: (m[0] - p["lat"]) ** 2 + (m[1] - p["lon"]) ** 2)
        mates = mates[:MAX_NEIGHBOURS]
        if len(mates) + 1 >= MIN_FOR_AXIS:
            p["bearing"] = local_bearing(p["lat"], p["lon"], mates)
            measured += 1
        else:
            p["bearing"] = 0.0
            fallback += 1

    feats = [{
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
        "properties": {
            "id": p["id"],
            "street": p["street"],
            "district": p["district"],
            "vehicle_type": p["vehicle_type"],
            "bearing": p["bearing"],
        },
    } for p in pts]

    fc = {"type": "FeatureCollection", "features": feats}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)
    upright = sum(1 for p in pts if p["bearing"] < 22.5 or p["bearing"] >= 157.5)
    lying = sum(1 for p in pts if 67.5 <= p["bearing"] < 112.5)
    print(f"build_meters: {len(pts)} spaces -> {OUT}")
    print(f"  bearing measured from neighbours: {measured}   upright fallback (no axis): {fallback}")
    print(f"  {upright} read as upright (N-S), {lying} read as lying (E-W), {len(pts) - upright - lying} on a diagonal")


if __name__ == "__main__":
    if "--check" in sys.argv:
        self_check()
    else:
        main()
