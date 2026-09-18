#!/usr/bin/env python3
"""HK City Monitor — AIS coverage test for Hong Kong waters.

WHY THIS EXISTS
AISStream.io is the only genuinely free live AIS feed, but it is *terrestrial*:
its own docs say coverage is strong in European/Atlantic waters and weak in Asia
and open ocean. So "we can add a ships layer" is an unproven assumption. This
script answers it with a number instead of a guess — subscribe to the Hong Kong
bounding box for a few minutes and count how many distinct vessels actually
appear.

If it returns a healthy count (tens+ in a few minutes), build the layer.
If it returns single digits, the layer would be a lie — don't build it.

USAGE
    pip install websockets                     # the VPS system python3 already has it
    export AISSTREAM_API_KEY=...               # free key from https://aisstream.io
    python3 scripts/test_ais_coverage.py --minutes 10

    # optional: --bbox "21.8,113.3,22.7,114.6"   (default = HK waters + approaches)
    # optional: --json out.json                  (dump raw observations)

Get the key: sign in at aisstream.io with GitHub, then copy the API key.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from collections import Counter

try:
    import websockets
except ImportError:                                   # pragma: no cover
    sys.exit("needs the websockets package:  pip install websockets")

STREAM = "wss://stream.aisstream.io/v0/stream"
DEFAULT_BBOX = (21.8, 113.3, 22.7, 114.6)             # HK waters + approaches (lat_min, lon_min, lat_max, lon_max)


def parse_bbox(text: str) -> tuple[float, float, float, float]:
    parts = [float(x) for x in text.split(",")]
    if len(parts) != 4:
        raise ValueError("bbox needs 4 comma-separated numbers")
    lat_min, lon_min, lat_max, lon_max = parts
    if not (lat_min < lat_max and lon_min < lon_max):
        raise ValueError("bbox min must be less than max")
    return lat_min, lon_min, lat_max, lon_max


async def collect(api_key: str, bbox: tuple, minutes: float) -> dict:
    lat_min, lon_min, lat_max, lon_max = bbox
    subscription = {
        "APIKey": api_key,
        "BoundingBoxes": [[[lat_min, lon_min], [lat_max, lon_max]]],
        "FilterMessageTypes": ["PositionReport"],
    }
    vessels: dict[int, dict] = {}
    types: Counter = Counter()
    messages = 0

    async with websockets.connect(STREAM, ping_interval=20, close_timeout=5) as ws:
        await ws.send(json.dumps(subscription))
        deadline = asyncio.get_running_loop().time() + minutes * 60
        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                break
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=min(remaining, 30))
            except asyncio.TimeoutError:
                continue                              # quiet spell is normal; keep waiting
            messages += 1
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if "error" in msg:
                raise RuntimeError(f"stream error: {msg['error']}")
            mtype = msg.get("MessageType", "?")
            types[mtype] += 1
            meta = msg.get("MetaData") or {}
            report = (msg.get("Message") or {}).get("PositionReport") or {}
            mmsi = meta.get("MMSI")
            if not mmsi:
                continue
            vessels[int(mmsi)] = {
                "name": (meta.get("ShipName") or "").strip(),
                "lat": report.get("Latitude", meta.get("latitude")),
                "lon": report.get("Longitude", meta.get("longitude")),
                "sog": report.get("Sog"),
                "cog": report.get("Cog"),
                "time": meta.get("time_utc"),
            }

    return {
        "minutes": minutes,
        "bbox": bbox,
        "messages_received": messages,
        "message_types": dict(types),
        "distinct_vessels": len(vessels),
        "sample": [{"mmsi": k, **v} for k, v in list(vessels.items())[:15]],
    }


def verdict(n: int, minutes: float) -> str:
    """The whole point of the run: a blunt go / no-go for the ships layer."""
    if minutes <= 0:
        return "no duration"
    per_hour = n / (minutes / 60)
    if n >= 30:
        return f"GO — {n} vessels, ~{per_hour:.0f}/hour. Healthy terrestrial coverage; build the layer."
    if n >= 10:
        return f"MARGINAL — {n} vessels, ~{per_hour:.0f}/hour. Enough for a harbour view only; label the coverage limit in the UI."
    if n >= 1:
        return f"NO-GO for a live layer — only {n} vessels. Coverage around HK is too thin; a ships layer would misrepresent empty sea as no traffic."
    return "NO-GO — zero vessels. Either no receivers cover HK, or the bbox/subscription is wrong. Check the key first."


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=10.0, help="how long to listen (default 10)")
    ap.add_argument("--bbox", default=",".join(str(x) for x in DEFAULT_BBOX))
    ap.add_argument("--json", help="write the raw observations to this path")
    args = ap.parse_args()

    key = os.environ.get("AISSTREAM_API_KEY", "").strip()
    if not key:
        print("AISSTREAM_API_KEY is not set.\n"
              "  Get a free key: https://aisstream.io  (sign in with GitHub)\n"
              "  Then: export AISSTREAM_API_KEY=...", file=sys.stderr)
        return 2

    bbox = parse_bbox(args.bbox)
    print(f"listening {args.minutes} min on HK bbox {bbox} …")
    result = asyncio.run(collect(key, bbox, args.minutes))

    print(json.dumps({k: v for k, v in result.items() if k != "sample"}, indent=2))
    print("\n" + verdict(result["distinct_vessels"], args.minutes))
    for v in result["sample"][:10]:
        print(f"  {v['mmsi']:<12} {v['name'][:22]:<22} {v['lat']}, {v['lon']}  sog={v['sog']}")

    # self-check: the numbers must be self-consistent or the report is meaningless
    assert result["messages_received"] >= 0
    assert result["distinct_vessels"] <= result["messages_received"] or result["messages_received"] == 0

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=1)
        print(f"\nwrote {args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
