#!/usr/bin/env python3
"""build_hiking_trails.py - AFCD hiking trails in country parks as LineStrings.

WHY THIS EXISTS: CSDI's 「郊野公園的遠足徑」 (afcd_rcd_1665568199103_4360) is the
official AFCD hiking-trail network — 167 polylines, served keyless from the
CSDI common folder (the same family as the weather-station and AQHI layers).
data.gov.hk links to it via the geoportal; the earlier "closed trails" service
(afcd_rcd_17425500968) was token-gated, but THIS one is open.

The layer draws green dashed (line-dasharray from the layer def); each feature
carries its own `color` so the existing lineLayer draws it without code change.

Usage:  python3 scripts/build_hiking_trails.py [--check]
"""
import json
import sys
import urllib.request

UA = "Mozilla/5.0 (compatible; HKCityMonitor/1.0)"
BASE = "https://portal.csdi.gov.hk/server/rest/services/common/afcd_rcd_1665568199103_4360/FeatureServer/0"
OUT = "data/hiking_trails.geojson"


def query(params: str) -> dict:
    req = urllib.request.Request(BASE + "/query?" + params, headers={"User-Agent": UA})
    return json.loads(urllib.request.urlopen(req, timeout=120).read().decode("utf-8"))


def _dp_simplify(pts: list, tol: float) -> list:
    """Douglas–Peucker in degrees. 5 m ≈ 0.00005° (lon scaled by cos 22° ≈ 0.93,
    so 0.00005° is ~5.4 m east, ~5.6 m north — round caps hide the rest)."""
    if len(pts) <= 2:
        return pts

    def perp(a, b, c):
        (ax, ay), (bx, by), (cx, cy) = a, b, c
        dx, dy = bx - ax, by - ay
        if dx == dy == 0:
            return ((cx - ax) ** 2 + (cy - ay) ** 2) ** 0.5
        t = ((cx - ax) * dx + (cy - ay) * dy) / (dx * dx + dy * dy)
        t = max(0.0, min(1.0, t))
        px, py = ax + t * dx, ay + t * dy
        return ((cx - px) ** 2 + (cy - py) ** 2) ** 0.5

    stack = [(0, len(pts) - 1)]
    keep = {0, len(pts) - 1}
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        d_max, k = 0.0, -1
        for m in range(i + 1, j):
            d = perp(pts[i], pts[j], pts[m])
            if d > d_max:
                d_max, k = d, m
        if d_max > tol:
            keep.add(k)
            stack.append((i, k))
            stack.append((k, j))
    return [p for i, p in enumerate(pts) if i in keep]


def simplify(features: list[dict], tol: float = 0.00005) -> None:
    for f in features:
        g = f["geometry"]
        if g["type"] == "LineString":
            g["coordinates"] = _dp_simplify(g["coordinates"], tol)
        elif g["type"] == "MultiLineString":
            g["coordinates"] = [_dp_simplify(part, tol) for part in g["coordinates"]]


def build() -> list[dict]:
    total = query("f=json&returnCountOnly=true&where=1%3D1")["count"]
    features = []
    start = 0
    while start < total:
        d = query(
            f"f=geojson&outSR=4326&resultOffset={start}&resultRecordCount=1000"
            f"&outFields=*&where=1%3D1"
        )
        batch = d.get("features", [])
        if not batch:
            break
        for f in batch:
            props = {k: v for k, v in (f.get("properties") or {}).items() if v is not None}
            props["color"] = "#22c55e"  # green: the lineLayer reads this
            features.append({"type": "Feature", "geometry": f.get("geometry"), "properties": props})
        start += len(batch)
    return features


def main() -> None:
    features = build()
    assert len(features) >= 150, f"expected ~167 trails, got {len(features)}"
    simplify(features)
    kinds = {}
    for f in features:
        kinds[f["geometry"]["type"]] = kinds.get(f["geometry"]["type"], 0) + 1
    print("trails:", len(features), "| 幾何:", kinds)
    print("首條 props:", json.dumps(features[0]["properties"], ensure_ascii=False)[:400])
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump({"type": "FeatureCollection", "features": features}, fh, ensure_ascii=False, indent=1)
    if "--check" in sys.argv:
        bad = [f for f in features if f["geometry"]["type"] not in ("LineString", "MultiLineString")]
        assert not bad, "全部要係線幾何"
        print(f"OK: {len(features)} 條遠足徑（線幾何，已簡化），已寫 {OUT}")


if __name__ == "__main__":
    main()
