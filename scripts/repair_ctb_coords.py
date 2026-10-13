#!/usr/bin/env python3
"""One-off repair: resolve Citybus stop coordinates and re-pick the live sample.

The full bake already produced routes + stops; only the Citybus coordinate
lookup was broken (wrong field name, `lon` instead of `long`), so re-running
the whole 40-minute bake to fix it would be wasteful. This reuses the bake
script's own helpers on the data already on disk.

Usage: python3 scripts/repair_ctb_coords.py
"""
import importlib.util
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("bake", HERE / "build_bus_data.py")
bake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bake)

routes = json.loads((HERE.parent / "data/bus_routes.json").read_text(encoding="utf-8"))
stops = json.loads((HERE.parent / "data/bus_stops.json").read_text(encoding="utf-8"))

ids = sorted({s["stop"] for r in routes.values() if r["co"] == "CTB" for s in r.get("stops", [])})
print(f"Citybus stops to resolve: {len(ids)}")
found = bake.fetch_ctb_coords(ids)
print(f"coordinates found: {len(found)}")
stops.update(found)
(HERE.parent / "data/bus_stops.json").write_text(
    json.dumps(stops, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
)

live = bake.pick_live_stops(routes, stops, {"KMB": 24, "CTB": 10})
(HERE.parent / "data/bus_live_stops.json").write_text(
    json.dumps(live, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
)
print(f"live sample: {len(live['KMB'])} KMB stops, {len(live['CTB'])} Citybus stop-route pairs")
print(f"stops total: {len(stops)}")

missing = [p for p in live["CTB"] if p["stop"] not in stops]
assert not missing, f"picked Citybus stops with no coordinates: {missing[:3]}"
assert live["KMB"], "live sample has no KMB stops"
print("OK")
