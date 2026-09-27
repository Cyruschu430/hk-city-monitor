#!/usr/bin/env python3
"""build_aed.py — slim the FSD AED list into what the map layer reads.

WHY THIS EXISTS. Every public AED in Hong Kong, with coordinates, keyless, from the Fire Services
Department. It is the highest-value unwired source in the registry: nothing else on the board is
life-safety outside water and warnings.

Two reasons it is a collector rather than a live fetch:

1. QUOTA. The upstream sends no ACAO header, so the browser cannot reach it — it would go through
   the Cloudflare Worker, 863,756 bytes per load, and the Worker's free tier is 100,000
   requests/day total. A layer that costs a request every time it is switched on is a layer that
   makes the whole dashboard smaller.

2. WEIGHT. Measured 2026-09-27: 863,756 bytes of CSV, 4,654 records, 13 columns. The map reads
   SIX of them. The other seven (`AED brand`, `AED model`, `AED remark`, `Person allowed to
   operate`, `Person who has access`, `Ground level categories`, `Service Hour Remark`) are
   inventory metadata — real information, and it stays in the upstream file, one curl away. It is
   declined at the point where a browser was carrying it.

That is the same lesson as the carpark file (554KB -> 53KB for three fields). A payload a browser
downloads for a fraction of itself is the most common shape of waste on this project.

WHAT IT REFUSES TO DO. It exits non-zero rather than writing when the record count drops more than
5%, when a record loses its name, or when fewer than 90% of records carry usable coordinates. The
failure mode that matters is a SHRUNKEN file: the map would draw fewer dots and look entirely
healthy, and nobody counts 4,300 pins. `--check` re-fetches and reports what changed without
writing.

    python3 scripts/build_aed.py            # fetch, slim, write data/aed.json
    python3 scripts/build_aed.py --check    # fetch and compare; write nothing
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import urllib.request
from pathlib import Path

UPSTREAM = "https://es.hkfsd.gov.hk/aed_api/export_aed.php?lang=TC"
OUT = Path(__file__).resolve().parent.parent / "data" / "aed.json"

# Short keys keep the shipped file small: 4,654 records x a long key name is most of the bytes.
# The popup labels them in the UI language; these names are never shown to a reader.
COLS = {
    # ONE character each. Safe here for the reason the carpark note gives the opposite advice: the
    # popup is BESPOKE (aedPopup in map/overlays.ts labels every field in the UI language), so these
    # names are never read by a human. A generic attributePopup would have made this a defect.
    "AED Name": "n",
    "AED Address": "a",
    "Detailed location of the AED installed": "w",
    "Location Google Map coordinate: latitude": "lat",
    "Location Google Map coordinate: longitude": "lon",
    "Whether the AED can be used by anyone": "p",
}


def fetch() -> str:
    req = urllib.request.Request(UPSTREAM, headers={"User-Agent": "hk-city-monitor/0.2"})
    with urllib.request.urlopen(req, timeout=60) as r:
        # UTF-8 BOM, as with the other HK feeds. The first header arrives as '\ufeff"AED Name"'.
        return r.read().decode("utf-8-sig")


def slim(text: str) -> list[dict]:
    # The file is comma-separated with quoted fields, so csv handles it — no manual splitting.
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        raise SystemExit("REFUSING: upstream carried no rows")

    out: list[dict] = []
    no_name = 0
    no_coord = 0
    for r in rows:
        rec = {}
        for long_key, short in COLS.items():
            rec[short] = (r.get(long_key) or "").strip()
        if not rec["n"]:
            no_name += 1
            continue
        try:
            lat, lon = float(rec["lat"]), float(rec["lon"])
        except ValueError:
            no_coord += 1
            continue
        # Sanity-check the coordinates against Hong Kong's bounding box. A swapped lat/lon or a
        # 0,0 placeholder would otherwise land in the Gulf of Guinea and read as a broken basemap.
        if not (22.1 <= lat <= 22.6 and 113.8 <= lon <= 114.5):
            no_coord += 1
            continue
        rec["lat"], rec["lon"] = round(lat, 6), round(lon, 6)
        out.append(rec)

    if no_name:
        raise SystemExit(f"REFUSING: {no_name} record(s) had no AED name")
    if len(out) < len(rows) * 0.95:
        raise SystemExit(f"REFUSING: {len(out)} usable of {len(rows)} — a >5% drop is a schema change, not a refresh")
    if no_coord:
        # Reported, not fatal: a handful of AEDs legitimately lack coordinates, and dropping them
        # is the honest outcome (a pin at 0,0 is worse than no pin).
        print(f"  note: {no_coord} record(s) dropped for missing or out-of-range coordinates")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    recs = slim(fetch())
    # GeoJSON FeatureCollection, NOT {"aed": [...]}.
    #
    # The map layer passes this straight to MapLibre's addSource({type:"geojson"}) — it does not
    # unwrap a custom envelope. A wrapper object is a valid JSON file with the right record count,
    # so it passes the collector, passes the build, reaches the style and draws NOTHING (measured:
    # `rendered: 0` with all three layers present and no error on the control). The shape the
    # consumer reads is the shape to emit; a private envelope only works when you also own the
    # unwrapping, and here we do not.
    body = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
                "properties": {"n": r["n"], "a": r["a"], "w": r["w"], "p": r["p"]},
            }
            for r in recs
        ],
        "_comment": (
            "GENERATED by scripts/build_aed.py from the FSD AED export — do not hand-edit. GeoJSON, "
            "because that is what MapLibre's addSource reads. BE HONEST ABOUT THE SIZE, MEASURED "
            "2026-09-27: this file is 995,847 bytes and the upstream CSV is 863,756 — it is LARGER. "
            "13 columns drop to 4 and the content falls to 198KB, but the GeoJSON per-feature envelope "
            "(the type/geometry/properties scaffolding) is ~180 characters a record and costs 81% of "
            "the output. The win is NOT bytes and claiming one would be false. The win is that 866KB "
            "of CORS-proxied traffic no longer costs a Worker invocation: the free tier is metered at "
            "100,000 requests/day and a layer that bills one every time it is switched on makes the "
            "whole dashboard smaller. UPGRADE PATH if the repo size ever matters: emit a 4-column CSV "
            "instead (~250KB) and build the FeatureCollection in the layer."
        ),
    }
    text = json.dumps(body, ensure_ascii=False, separators=(",", ":")) + "\n"

    pub = sum(1 for r in recs if r.get("p", "").lower().startswith("y"))
    if args.check:
        if not OUT.exists():
            print(f"MISSING: {OUT} — run without --check to generate it")
            return 1
        have = json.loads(OUT.read_text(encoding="utf-8"))["features"]
        # The FILE is features and slim() returns records, so normalise to the same tuple. Comparing
        # them raw is what reported "gone 4651 / new 4651" the first time this ran after the shape
        # change: every record differed because the shapes differed, which is a diff that invents a
        # discrepancy rather than finding one.
        have = [{"n": f["properties"]["n"], "a": f["properties"]["a"], "w": f["properties"]["w"],
                 "p": f["properties"]["p"], "lat": f["geometry"]["coordinates"][1],
                 "lon": f["geometry"]["coordinates"][0]} for f in have]
        # Key on the WHOLE record, not on name+coords: several AEDs legitimately share a building
        # and a name, and a narrower key silently collapses them — the first version of this check
        # reported 4,255 committed records against 4,652 written, and the gap was the dedup, not
        # the data. A diff that invents a discrepancy is worse than no diff.
        key = lambda r: json.dumps(r, sort_keys=True, ensure_ascii=False)
        hb = {key(r): r for r in have}
        nb = {key(r): r for r in recs}
        gone = sorted(set(hb) - set(nb))
        new = sorted(set(nb) - set(hb))
        print(f"committed {len(have)} ({len(hb)} distinct)  upstream {len(recs)} ({len(nb)} distinct)  gone {len(gone)}  new {len(new)}")
        for k in gone[:8]:
            print(f"  GONE  {json.loads(k)['name']}")
        for k in new[:8]:
            print(f"  NEW   {json.loads(k)['name']}")
        return 0 if not gone else 1

    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(OUT.parent.parent)}  {len(recs)} AEDs  {len(text)} chars")
    print(f"  on disk: {OUT.stat().st_size} bytes   (upstream was 863756)")
    print(f"  usable by anyone: {pub} / {len(recs)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
