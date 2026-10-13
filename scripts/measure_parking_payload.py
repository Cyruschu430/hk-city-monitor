"""measure_parking_payload.py — what would a smaller parking file actually save, gzipped?

Cloudflare serves gzip, so the raw size is not the number that matters. This prints
both, at a few coordinate precisions, so the decision is made on bytes over the wire.
Cheap to re-run after any change to data/parking_meters.geojson.
"""
import gzip
import json

SRC = "data/parking_meters.geojson"
SHIP = "data/parking_meters_lite.json"  # generated, currently unused by any source


def gz(obj) -> tuple[float, float]:
    b = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()
    return len(b) / 1048576, len(gzip.compress(b, 6)) / 1024


d = json.load(open(SRC, encoding="utf-8"))
print(f"{SRC} as shipped: {gz(d)[0]:.2f}MB raw / {gz(d)[1]:.0f}KB gzipped ({len(d['features'])} bays)")

try:
    lite = json.load(open(SHIP, encoding="utf-8"))
    rows = lite["features"] if isinstance(lite, dict) else lite
    print(f"{SHIP}: {gz(lite)[0]:.2f}MB raw / {gz(lite)[1]:.0f}KB gzipped ({len(rows)} bays)")
except FileNotFoundError:
    print(f"{SHIP}: not present")

# ponytail: mutate a copy in memory only — this measures, it does not write data back.
for nd in (6, 5, 4):
    copy = json.loads(json.dumps(d))
    for f in copy["features"]:
        c = f["geometry"]["coordinates"]
        f["geometry"]["coordinates"] = [round(c[0], nd), round(c[1], nd)]
    raw, gzipped = gz(copy)
    metres = 111_320 * 10 ** -nd
    print(f"  coordinates rounded to {nd} decimals (~{metres:.1f} m): {raw:.2f}MB raw / {gzipped:.0f}KB gzipped")
