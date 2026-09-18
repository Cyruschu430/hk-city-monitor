#!/usr/bin/env python3
"""HK City Monitor — camera data builder.

Fetches the two official HK camera catalogues and writes static JSON for the
front end. Both sources are keyless and hotlinkable; nothing here needs a backend.

  TD   交通快拍 987 台  https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.csv
  HKO  天氣攝影機 34 站  https://www.hko.gov.hk/en/wxinfo/ts/index_webcam.htm
                        https://www.hko.gov.hk/wxinfo/aws/hko_mica/{stn}/latest_HD_{STN}.jpg

Run:  python3 build_cameras.py            # writes data/*.json
      python3 build_cameras.py --check    # self-check, no writes
"""
import csv
import io
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)          # repo root, served by nginx as /hkmonitor/
OUT = os.path.join(ROOT, "data")

TD_CSV = ("https://static.data.gov.hk/td/traffic-snapshot-images/code/"
          "Traffic_Camera_Locations_Tc.csv")
UA = {"User-Agent": "hk-city-monitor/0.1 (+open data client)"}

# HKO weather-photo stations. Codes come from the photo filenames on
# https://www.hko.gov.hk/en/wxinfo/ts/index_webcam.htm (34 stations).
# Coords are the site location: taken from the HKO AWS station table where the
# code matches an AWS station, otherwise the landmark the camera is installed at
# (marked approx=True — these are site positions, not surveyed camera positions).
HKO_STATIONS = [
    ("LFS", "流浮山", "Lau Fau Shan", 22.46889, 113.98361, False),
    ("WLP", "濕地公園", "Wetland Park", 22.46667, 114.00889, False),
    ("ELC", "上水風采中學", "Elegantia College, Sheung Shui", 22.50250, 114.12650, True),
    ("KFB", "嘉道理農場", "Kadoorie Farm and Botanic Garden", 22.43278, 114.12083, False),
    ("TPK", "大埔滘", "Tai Po Kau", 22.44250, 114.18389, False),
    ("TM2", "大帽山（西南）", "Tai Mo Shan (SW)", 22.41050, 114.12440, True),
    ("TM3", "大帽山（東北）", "Tai Mo Shan (NE)", 22.41050, 114.12440, True),
    ("TLC", "大欖涌", "Tai Lam Chung", 22.36670, 114.01670, True),
    ("SK2", "西貢水警東（東北）", "Sai Kung Marine East (NE)", 22.38020, 114.28300, True),
    ("SKG", "西貢水警東（東南）", "Sai Kung Marine East (SE)", 22.37556, 114.27444, False),
    ("CWB", "清水灣（東）", "Clear Water Bay (E)", 22.26333, 114.29972, False),
    ("CWA", "清水灣（西南）", "Clear Water Bay (SW)", 22.27000, 114.29100, True),
    ("KS2", "滘西洲", "Kau Sai Chau", 22.35500, 114.31600, True),
    ("KLT", "九龍城", "Kowloon City", 22.33500, 114.18472, False),
    ("HK2", "尖沙咀、環球貿易廣場", "Tsim Sha Tsui & ICC", 22.30270, 114.17420, True),
    ("HKO", "尖沙咀", "Tsim Sha Tsui", 22.30194, 114.17417, False),
    ("HMM", "香港海事博物館", "Hong Kong Maritime Museum", 22.28550, 114.16150, True),
    ("VPB", "太平山（北）", "Victoria Peak (N)", 22.27110, 114.14900, True),
    ("VPA", "太平山（東）", "Victoria Peak (E)", 22.27110, 114.14900, True),
    ("GSI", "德瑞國際學校", "German Swiss International School", 22.26670, 114.14440, True),
    ("SWH", "西灣河", "Sai Wan Ho", 22.28300, 114.22200, True),
    ("SLW", "沙螺灣", "Sha Lo Wan", 22.29111, 113.90694, False),
    ("PE2", "坪洲（遠眺竹篙灣）", "Peng Chau (Penny's Bay)", 22.28330, 114.03330, True),
    ("DNL", "坪洲（遠眺維港）", "Peng Chau (Victoria Harbour)", 22.28600, 114.03800, True),
    ("CCH", "長洲（北）", "Cheung Chau (N)", 22.20111, 114.02667, False),
    ("CCE", "長洲東灣", "Cheung Chau Tung Wan", 22.20800, 114.02800, True),
    ("LAM", "南丫島", "Lamma Island", 22.22611, 114.10861, False),
    ("WL2", "橫瀾島（西北）", "Waglan Island (NNW)", 22.18222, 114.30333, False),
    ("WGL", "橫瀾島（北）", "Waglan Island (N)", 22.18222, 114.30333, False),
    ("CS1", "長沙（西北）", "Cheung Sha (NW)", 22.22800, 113.93700, True),
    ("CS2", "長沙（北）", "Cheung Sha (N)", 22.22800, 113.93700, True),
    ("CP1", "中環碼頭", "Central Pier", 22.28889, 114.15583, False),
    ("IC1", "環球貿易廣場（東南）", "ICC (SE)", 22.30330, 114.16030, True),
    ("IC2", "環球貿易廣場（西南）", "ICC (SW)", 22.30330, 114.16030, True),
]

TD_IMG = "https://tdcctv.data.one.gov.hk/{key}.JPG"
HKO_IMG = "https://www.hko.gov.hk/wxinfo/aws/hko_mica/{low}/latest_HD_{code}.jpg"


def fetch(url, timeout=60):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def build_td():
    raw = fetch(TD_CSV)
    # data.gov.hk ships this CSV as UTF-16LE with tab separators, and it starts
    # with a DOUBLE BOM (\xff\xfe\xff\xfe) so the decoder leaves a stray \ufeff
    # on the first field name — strip it or every row.get("key") is None.
    text = raw.decode("utf-16") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8-sig")
    text = text.lstrip("\ufeff")
    rows = list(csv.DictReader(io.StringIO(text), delimiter="\t"))
    cams = []
    for r in rows:
        key = (r.get("key") or "").strip()
        try:
            lat, lon = float(r["latitude"]), float(r["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        if not key or not lat or not lon:
            continue
        cams.append({
            "id": key,
            "name": (r.get("description") or "").strip(),
            "district": (r.get("district") or "").strip(),
            "region": (r.get("region") or "").strip(),
            "lat": lat,
            "lon": lon,
            "img": TD_IMG.format(key=key),
        })
    return cams


def build_hko():
    return [{
        "id": code,
        "name": zh,
        "name_en": en,
        "lat": lat,
        "lon": lon,
        "approx": approx,
        "img": HKO_IMG.format(low=code.lower(), code=code),
    } for code, zh, en, lat, lon, approx in HKO_STATIONS]


def self_check(td, hko):
    assert len(td) > 900, f"TD camera count suspiciously low: {len(td)}"
    assert len(hko) == len(HKO_STATIONS), f"HKO stations: {len(hko)}"
    assert all(c["img"].endswith(".JPG") for c in td)
    assert all("latest_HD_" in c["img"] for c in hko)
    lats = [c["lat"] for c in td + hko]
    lons = [c["lon"] for c in td + hko]
    assert all(22.0 < x < 22.7 for x in lats), "latitude outside HK"
    assert all(113.7 < x < 114.5 for x in lons), "longitude outside HK"
    ids = [c["id"] for c in td]
    assert len(ids) == len(set(ids)), "duplicate TD camera ids"
    print("self-check OK")


def main():
    check_only = "--check" in sys.argv
    td, hko = build_td(), build_hko()
    self_check(td, hko)
    if check_only:
        return
    os.makedirs(OUT, exist_ok=True)
    for name, payload in (("cameras_td.json", td), ("cameras_hko.json", hko)):
        path = os.path.join(OUT, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        print(f"{name}: {len(payload)} records, {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
