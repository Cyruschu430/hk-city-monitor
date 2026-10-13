#!/usr/bin/env python3
"""build_meters.py — on-street parking SPACE positions (TD psi parking spaces).

Reads the official space-info CSV (every metered space with a sensor: id, street,
district, coordinates) and writes data/parking_meters.geojson. The occupancy feed
(occupancystatus.csv) shares ParkingSpaceId, so the adapter joins these positions
to live O/V status; this file is positions only, as-issued.

Each space also gets a `bearing`: the direction the bay LIES ALONG, in degrees
clockwise from north, so a bay on an east-west street is drawn lying east-west
instead of every bay on the map standing upright.

Three ways were tried; the reasons the first two fail are worth keeping, because both
look correct until you measure them:

  · One angle per street name. 香島道 is 4 km of curves; its bays would all be drawn at
    the chord angle, standing across their own kerb at both ends.
  · The nearest neighbouring space. On a wide road the bay opposite is often the nearest
    neighbour, and that vector points ACROSS the street — 90° out.
  · Bays LIE along the kerb, and the kerb is what the immediate neighbours measure. So:
    the principal axis of the same-street spaces within 18 m. Two kerbs of a normal
    street are both inside 18 m and are collinear along it, so they simply confirm the
    axis; a 25-30 m dual carriageway puts the far kerb outside the radius, which is what
    keeps the axis on this kerb. Local + tight is also what follows a curve.
  · If the cluster is not shape-like (fewer than 3 spaces, or the axis barely beats the
    across-width — a junction, a bay beside a crossing, a bay with neighbours in two
    directions) the local answer is not trustworthy, so the street's own dominant
    direction is used instead. With 20,749 bays to average, a street's dominant direction
    is a much better estimate than four nearby points. Counts are printed; "mostly fine"
    is not a thing to claim silently.
"""
import csv
import json
import math
import sys
import urllib.request

URL = "https://resource.data.one.gov.hk/td/psiparkingspaces/spaceinfo/parkingspaces.csv"
OUT = "data/parking_meters.geojson"
RADIUS_M = 18.0
MAX_NEIGHBOURS = 6
MIN_FOR_AXIS = 3
# Along-axis variance must beat the across-axis by this much for the cluster to count as
# a line at all. A grid of bays at a junction gives a blob (ratio ~1); a row gives >> 3.
MIN_ASPECT = 1.8


def axis_of(lat: float, lon: float, mates: list[tuple[float, float]]) -> tuple[float, float]:
    """Principal axis of the cluster, plus the aspect ratio that says whether it is a line.

    Returns (bearing in degrees clockwise from north folded to 0..180, lambda1/lambda2).
    Only the direction of the axis is meaningful, never the sign, hence 0..180.
    """
    k = math.cos(math.radians(lat))
    pts = [(lat, lon)] + mates
    mlat = sum(la for la, _ in pts) / len(pts)
    mlon = sum(lo for _, lo in pts) / len(pts)
    sxx = sxy = syy = 0.0
    for la, lo in pts:
        dx = (lo - mlon) * k
        dy = la - mlat
        sxx += dx * dx
        sxy += dx * dy
        syy += dy * dy
    if sxx == 0 and syy == 0:
        return 0.0, 1.0
    disc = math.sqrt((sxx - syy) ** 2 + 4 * sxy * sxy)
    l1 = (sxx + syy + disc) / 2
    l2 = max((sxx + syy - disc) / 2, 1e-18)
    bearing = round((90.0 - math.degrees(0.5 * math.atan2(2 * sxy, sxx - syy))) % 180.0, 1)
    return bearing, l1 / l2


def street_prior(bearings: list[float], weight: int = 1) -> float:
    """Dominant direction of a street from its bays' local axes, folded to 0..180.

    Doubling the angles makes 0° and 180° the same place before averaging, which is what
    an axis needs; the result is halved back.
    """
    x = sum(math.cos(math.radians(2 * b)) for b in bearings)
    y = sum(math.sin(math.radians(2 * b)) for b in bearings)
    if x == 0 and y == 0:
        return 0.0
    return round((math.degrees(math.atan2(y, x)) / 2) % 180.0, 1)


def angle_gap(a: float, b: float) -> float:
    """Smallest difference between two 0..180 axes."""
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def self_check() -> None:
    """The cases that broke earlier versions, as runnable assertions."""
    row = [(22.30, 114.170 + i * 0.00005) for i in range(1, 5)]  # east-west, ~5.5 m apart
    b, aspect = axis_of(22.30, 114.16995, row)
    assert abs(b - 90) < 2, f"east-west row gave {b}, want ~90"
    assert aspect > 3, f"a row of bays should look like a line, aspect={aspect:.1f}"
    col = [(22.30 + i * 0.00005, 114.170) for i in range(1, 5)]  # north-south
    b, _ = axis_of(22.30, 114.170, col)
    assert min(abs(b), 180 - abs(b)) < 2, f"north-south column gave {b}, want ~0"
    # A SQUARE BLOB (junction: bays along and across) must be reported as not-a-line, so
    # the street prior takes over instead of a confident 45°.
    blob = [(22.30000, 114.17010), (22.30000, 114.16990), (22.30010, 114.17000), (22.29990, 114.17000)]
    _, aspect = axis_of(22.30000, 114.17000, blob)
    assert aspect < MIN_ASPECT, f"a square cluster should not pass the line test, aspect={aspect:.2f}"
    # Street prior: five bays at 88-92° must come back ~90, not dragged by an outlier.
    assert abs(street_prior([88, 90, 92, 89, 5]) - 90) < 12, "street prior moved by a single outlier"
    print("self-check ok: rows and columns measured, square clusters rejected, street prior robust")


def main() -> None:
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0 (compatible; HKCityMonitor/1.0)"})
    raw = urllib.request.urlopen(req, timeout=60).read().decode("utf-8-sig")
    lines = raw.splitlines()
    # The file opens with a publish-date line, a blank row, then the header. Skip until
    # the actual header (first cell = PoleId) so DictReader sees real columns.
    start = next(i for i, ln in enumerate(lines) if ln.strip().startswith("PoleId"))
    rows = list(csv.DictReader(lines[start:]))

    pts: list[dict] = []
    for r in rows:
        sid = (r.get("ParkingSpaceId") or "").strip()
        lat, lon = r.get("Latitude") or "", r.get("Longitude") or ""
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

    # Grid bucket by street + ~18 m cell, so the neighbour search is not 20,749² .
    dlat = RADIUS_M / 111_320.0
    cell: dict[tuple[str, int, int], list[int]] = {}
    for i, p in enumerate(pts):
        cell.setdefault((p["street"], int(p["lat"] / dlat),
                         int(p["lon"] / (dlat / math.cos(math.radians(p["lat"]))))), []).append(i)

    def mates_within(i: int) -> list[tuple[float, float]]:
        p = pts[i]
        dlon = dlat / math.cos(math.radians(p["lat"]))
        cx, cy = int(p["lon"] / dlon), int(p["lat"] / dlat)
        found: list[tuple[float, float, float]] = []
        for gx in (cx - 1, cx, cx + 1):
            for gy in (cy - 1, cy, cy + 1):
                for j in cell.get((p["street"], gy, gx), []):
                    if j == i:
                        continue
                    q = pts[j]
                    dy = (q["lat"] - p["lat"]) * 111_320.0
                    dx = (q["lon"] - p["lon"]) * 111_320.0 * math.cos(math.radians(p["lat"]))
                    d = math.hypot(dx, dy)
                    if d <= RADIUS_M:
                        found.append((q["lat"], q["lon"], d))
        found.sort(key=lambda m: m[2])
        return [(la, lo) for la, lo, _ in found[:MAX_NEIGHBOURS]]

    # Pass 1: local axis where the cluster is a line.
    trusted: dict[str, list[float]] = {}
    local: list[float | None] = []
    for i, p in enumerate(pts):
        mates = mates_within(i)
        if len(mates) + 1 < MIN_FOR_AXIS:
            local.append(None)
            continue
        bearing, aspect = axis_of(p["lat"], p["lon"], mates)
        if aspect < MIN_ASPECT:
            local.append(None)
            continue
        local.append(bearing)
        trusted.setdefault(p["street"], []).append(bearing)

    # Pass 2: each street's dominant direction, from the bays that were confident.
    prior = {s: street_prior(bs) for s, bs in trusted.items()}

    # Pass 3: assign — the local axis where it was measured, else the street's direction,
    # else upright (a bay with nothing to learn from; counted and reported).
    measured = from_street = fallback = 0
    for i, p in enumerate(pts):
        if local[i] is not None:
            p["bearing"] = local[i]
            measured += 1
        elif p["street"] in prior:
            p["bearing"] = prior[p["street"]]
            from_street += 1
        else:
            p["bearing"] = 0.0
            fallback += 1

    feats = [{
        "type": "Feature",
        # 6 decimals ≈ 0.1 m — a bay is ~5 m long, so the error is 2% of the thing being
        # drawn, and the digits were the largest remaining lever on the gzipped payload
        # (381 KB -> 275 KB, measured with scripts/measure_parking_payload.py). The
        # data/parking_meters_lite.json idea saved less than this (307 KB) while dropping
        # the bearing and needing a second schema kept in sync, so it was removed.
        "geometry": {"type": "Point", "coordinates": [round(p["lon"], 6), round(p["lat"], 6)]},
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
    streets = len({p["street"] for p in pts if p["street"]})
    print(f"build_meters: {len(pts)} spaces in {streets} streets -> {OUT}")
    print(f"  {measured} measured from their own kerb (18 m), {from_street} took the street's direction, {fallback} left upright")
    print(f"  {upright} read as upright (N-S), {lying} read as lying (E-W), {len(pts) - upright - lying} on a diagonal")


if __name__ == "__main__":
    if "--check" in sys.argv:
        self_check()
    else:
        main()
