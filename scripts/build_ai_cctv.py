#!/usr/bin/env python3
"""build_ai_cctv.py — TD AI Video Analytics CCTVs: the 16 positions AND their live readings.

CSDI td_rcd_1671693527354_28926 = "Traffic data from AI Video Analytics System of CCTVs":
16 CCTV points (official geometry) whose `url` field is the per-camera JSON
(td2132022opendata.td.gov.hk/{key}) carrying per-segment speed + flow every 15 minutes.

WHY THE NUMBERS ARE BAKED HERE RATHER THAN FETCHED IN THE BROWSER. MEASURED 2026-10-13: that
host sends NO CORS header at all — no Access-Control-Allow-Origin even when the request carries
an Origin, and OPTIONS answers 405 — so a browser cannot read it, and the layer's popup printed
「流量 —」 for every camera while the app claimed live speed. A server-side pass is the only way
to get the numbers, and `data/ai_cctv.geojson` is published to the `live-data` branch by
live_cycle.sh, which .github/workflows/live-publish.yml runs every ~10 minutes, so what the
browser reads is at most one cycle behind the publisher's own 15-minute cadence.

`observed` is the feed's OWN `generated_timestamp`, formatted HKT like every other time in this
app: a reader looking at a jam must be able to tell whether they are seeing this minute or the
last quarter hour, and that is the one clock that can say so.

A camera with `Is_valid: N` (PTZ moved off its reference view) or with every segment at 0/0 has
no figure to give — it keeps its position (the camera IS there) and carries no speed, which is
what the popup renders as 「暫無實時數據」 rather than as a stopped road.

Usage:  python3 scripts/build_ai_cctv.py [--check]
"""
import datetime
import json
import sys
import urllib.parse
import urllib.request

UA = "Mozilla/5.0 (compatible; HKCityMonitor/1.0; +https://hk-city-monitor.pages.dev)"
HKT = datetime.timezone(datetime.timedelta(hours=8))
DSID = "td_rcd_1671693527354_28926"
LAYER = "Traffic_Data_from_AI_Video_Analytics_System_of_CCTVs"
OUT = "data/ai_cctv.geojson"


def fetch_json(url: str, timeout: int = 45) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def read_camera(url: str) -> dict:
    """One camera's reading, or {} when it has no figure.

    The zero-segment rule is the whole reason this is not a one-liner: a segment that reports
    speed 0 AND flow 0 is a segment with no traffic to measure, not a stopped road, and averaging
    it in would print 0 km/h for a camera that simply has nothing to say.
    """
    d = fetch_json(url, timeout=30)
    if str(d.get("Is_valid", "")).upper() != "Y":
        return {}
    segments = [
        s
        for s in (d.get("traffic_data") or [])
        if (float(s.get("speed") or 0) > 0) or (float(s.get("flow") or 0) > 0)
    ]
    if not segments:
        return {}
    speed = round(sum(float(s.get("speed") or 0) for s in segments) / len(segments))
    flow = int(sum(float(s.get("flow") or 0) for s in segments))
    return {"speed": str(speed), "flow": str(flow), "observed": hkt_hm(str(d.get("generated_timestamp") or "")), "generated": str(d.get("generated_timestamp") or "")}


def hkt_hm(stamp: str) -> str:
    """The publisher's timestamp as HKT HH:MM, or "" when it cannot be read.

    TD publishes Hong Kong wall time with NO offset (measured: `2026-10-14T00:54:40` while the
    clock in Hong Kong read 00:54), so a naive stamp is already HKT and must NOT be shifted
    again — that printed 08:54 for a reading taken at 00:54. An offset, if the publisher ever
    adds one, is honoured.
    """
    try:
        d = datetime.datetime.fromisoformat(stamp.replace(" ", "T"))
    except ValueError:
        return ""
    if d.tzinfo is not None:
        d = d.astimezone(HKT)
    return d.strftime("%H:%M")


def build() -> tuple[list[dict], int, str]:
    q = urllib.parse.urlencode({"dataset_id": DSID, "format": "geojson", "layer_name": LAYER})
    fc = fetch_json(f"https://portal.csdi.gov.hk/csdi-webpage/file-api?{q}", timeout=90)
    features, readings = [], 0
    for f in fc.get("features", []):
        p = f.get("properties", {})
        props = {
            "key": p.get("key_"),
            "region": p.get("region"),
            "district": p.get("district"),
            "description": p.get("description"),
            "url": p.get("url"),
        }
        try:
            live = read_camera(str(p.get("url") or ""))
        except Exception as exc:  # noqa: BLE001 — one dead camera must not sink the other 15
            print(f"  ! {props['key']}: {exc}")
            live = {}
        if live:
            readings += 1
            props["speed"] = live["speed"]
            props["flow"] = live["flow"]
            props["observed"] = live["observed"]
            props["generated"] = live["generated"]
        features.append({"type": "Feature", "geometry": f["geometry"], "properties": props})
    # The newest analysis time across the cameras, at the top level: the panel's own clock reads
    # it instead of `new Date()`, which would claim the reading was taken when we fetched it.
    stamps = [f["properties"].get("generated") for f in features if f["properties"].get("generated")]
    generated = max(stamps) if stamps else ""
    return features, readings, generated


def main() -> None:
    features, readings, generated = build()
    assert len(features) >= 15, f"expected 16 AI CCTV, got {len(features)}"
    for f in features:
        lon, lat = f["geometry"]["coordinates"]
        assert 113.8 < lon < 114.5 and 22.2 < lat < 22.6, (lon, lat)
        assert str(f["properties"]["url"]).startswith("https://td2132022opendata.td.gov.hk/"), f["properties"]["url"]
        sp = f["properties"].get("speed")
        if sp is not None:
            assert int(sp) >= 0, f"camera {f['properties']['key']}: negative speed {sp}"
            assert len(str(f["properties"]["observed"])) == 5, f"camera {f['properties']['key']}: observed is not HH:MM"
    # The CORS finding is why this file is baked at all, and a run where nothing answered would
    # otherwise publish positions with no numbers under a comment claiming live readings.
    assert readings > 0, "no camera answered with a reading — check the endpoint before publishing"
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(
            {"type": "FeatureCollection", "generated": generated, "features": features},
            fh,
            ensure_ascii=False,
            indent=1,
        )
    if "--check" in sys.argv:
        print(f"AI 影像分析閉路電視: {len(features)} 部 · 有讀數 {readings} 部 · 最新分析 {generated or '—'}")


if __name__ == "__main__":
    main()
