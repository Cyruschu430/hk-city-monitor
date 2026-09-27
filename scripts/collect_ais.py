#!/usr/bin/env python3
r"""collect_ais.py - live vessel positions in Hong Kong waters, from aisstream.io.

BLOCKED ON ONE MANUAL STEP, and it says so rather than failing mysteriously. aisstream.io is free
but needs a key from a GitHub account (https://aisstream.io -> sign in with GitHub -> create an API
key). Drop it in one of these and this script needs no further change:

  1. AISSTREAM_API_KEY environment variable, or
  2. C:\hk-city-monitor\.aisstream_key  (one line, gitignored — NEVER commit it)

WHY A RELAY AND NOT THE WORKER. The stream is a WebSocket that has to stay open, and Cloudflare's
free tier cannot hibernate a Durable Object holding an outbound WebSocket (workerd #4864). World
Monitor solves this the same way: a sidecar container. Here the sidecar is this PC, which also means
the connection is OUTBOUND ONLY — there is no inbound port to attack, which is the property that
mattered when this was first raised.

A PARTIAL WINDOW IS NOT A FAILURE. The stream only carries vessels that transmit AIS, and coverage
in Hong Kong waters is good but not total: fishing boats and small craft often do not. The file says
how long it listened and how many it saw so a reader can tell "quiet" from "broken".

Usage:  py collect_ais.py [seconds]      (default 45s of listening)
"""
import json, os, sys, time
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "vessels.json")
KEYFILE = os.path.join(HERE, "..", ".aisstream_key")
URL = "wss://stream.aisstream.io/v0/stream"
# Hong Kong waters with margin: the harbour, the approaches, the Pearl River estuary mouth and the
# lanes south of the islands. south, west, north, east.
BBOX = [[22.05, 113.70], [22.65, 114.55]]
HK = timezone(timedelta(hours=8))


def read_key():
    k = os.environ.get("AISSTREAM_API_KEY", "").strip()
    if k:
        return k
    if os.path.exists(KEYFILE):
        with open(KEYFILE, encoding="utf-8") as fh:
            return fh.read().strip()
    return ""


def main():
    seconds = int(sys.argv[1]) if len(sys.argv) > 1 else 45
    key = read_key()
    if not key:
        print("BLOCKED no aisstream.io key. Put one in AISSTREAM_API_KEY or .aisstream_key "
              "(see the docstring). This run did NOT overwrite the previous file.", file=sys.stderr)
        return 2
    try:
        import websocket                                            # websocket-client
    except ImportError:
        print("BLOCKED python package 'websocket-client' is missing. "
              "Install it with:  py -m pip install websocket-client", file=sys.stderr)
        return 2

    seen, err = {}, None
    ws = websocket.create_connection(URL, timeout=30)
    try:
        ws.send(json.dumps({"APIKey": key, "BoundingBoxes": [BBOX]}))
        deadline = time.time() + seconds
        while time.time() < deadline:
            ws.settimeout(max(1, deadline - time.time()))
            try:
                raw = ws.recv()
            except Exception:                                        # noqa: BLE001 - timeout ends the loop
                break
            if not raw:
                continue
            msg = json.loads(raw)
            if msg.get("error"):
                err = str(msg["error"])
                break
            meta = (msg.get("MetaData") or {})
            body = msg.get("Message") or {}
            pos = body.get("PositionReport") or body.get("StandardClassBPositionReport") or {}
            static = body.get("ShipStaticData") or {}
            mmsi = str(meta.get("MMSI") or "")
            if not mmsi:
                continue
            lat = meta.get("latitude", pos.get("Latitude"))
            lon = meta.get("longitude", pos.get("Longitude"))
            if lat is None or lon is None:
                continue
            rec = seen.setdefault(mmsi, {"mmsi": mmsi})
            rec.update({"lat": lat, "lon": lon, "at": datetime.now(HK).strftime("%H:%M:%S")})
            name = (meta.get("ShipName") or static.get("Name") or "").strip()
            if name:
                rec["shipName"] = name
            if pos.get("Sog") is not None:
                rec["sog"] = round(float(pos["Sog"]), 1)
            if pos.get("Cog") is not None:
                rec["cog"] = round(float(pos["Cog"]), 1)
            if static.get("Destination"):
                rec["destination"] = str(static["Destination"]).strip()
    finally:
        try:
            ws.close()
        except Exception:                                            # noqa: BLE001 - best effort
            pass

    if err:
        print(f"FAIL aisstream rejected the subscription: {err}", file=sys.stderr)
        return 1
    if not seen:
        print(f"FAIL no position reports in {seconds}s — the stream answered but said nothing. "
              f"Previous file kept.", file=sys.stderr)
        return 1

    now = datetime.now(HK)
    body = json.dumps({"type": "FeatureCollection",
                       "_comment": (f"AIS positions heard over {seconds}s by scripts/collect_ais.py. "
                                     f"Coverage is what vessels actually transmitted; craft that do not "
                                     f"carry AIS are absent, not zero."),
                       "features": [{"type": "Feature",
                                     "geometry": {"type": "Point", "coordinates": [v["lon"], v["lat"]]},
                                     "properties": {k: v[k] for k in
                                                    ("mmsi", "shipName", "sog", "cog", "destination")
                                                    if k in v}}
                                    for v in seen.values()]},
                      ensure_ascii=False, separators=(",", ":"))
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(body)
    os.replace(tmp, OUT)
    print(f"OK   {os.path.basename(OUT)}  {len(body.encode('utf-8')):,} bytes  "
          f"{len(seen)} vessels heard in {seconds}s  as at {now.strftime('%H:%M')} HKT")
    return 0


if __name__ == "__main__":
    sys.exit(main())
