"""cmp_bearing.py — how many bays changed angle vs the previous committed bake?

Compares the working tree's data/parking_meters.geojson with the version in HEAD, so the
improvement is a number rather than a feeling. >45° means the bay used to be drawn
standing across its street and now lies along it (or vice versa).
"""
import json
import subprocess

old = json.loads(subprocess.run(["git", "show", "HEAD:data/parking_meters.geojson"],
                                capture_output=True, text=True, check=True).stdout)
new = json.load(open("data/parking_meters.geojson", encoding="utf-8"))
o = {f["properties"]["id"]: f["properties"].get("bearing", 0.0) for f in old["features"]}
n = {f["properties"]["id"]: f["properties"].get("bearing", 0.0) for f in new["features"]}


def gap(a, b):
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


shared = sorted(set(o) & set(n))
moved = [gap(o[i], n[i]) for i in shared]
big = [d for d in moved if d > 45]
mid = [d for d in moved if 15 < d <= 45]
print(f"{len(shared)} bays in both bakes ({len(n) - len(shared)} new, {len(o) - len(shared)} dropped)")
print(f"  barely moved (<=15°): {sum(1 for d in moved if d <= 15)}")
print(f"  shifted 15-45° (a skew corrected): {len(mid)}")
print(f"  turned >45° (was drawn across its street): {len(big)}")
if moved:
    print(f"  median change {sorted(moved)[len(moved) // 2]:.1f}°")
