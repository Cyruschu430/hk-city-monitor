#!/usr/bin/env python3
"""build_smartplay.py — LCSD SmartPLAY activities, slimmed for the browser.

The full feed is ~17MB with ~8,700 records; this keeps only upcoming activities
(PGM_END_DATE >= today) and the fields the panel needs.
"""
import json
import urllib.request
from datetime import date

URL = "https://data.smartplay.lcsd.gov.hk/rest/cms/api/v1/publ/contents/open-data/activity-prog/file"
UA = {"User-Agent": "Mozilla/5.0 (compatible; HKCityMonitor/1.0)"}

req = urllib.request.Request(URL, headers=UA)
raw = urllib.request.urlopen(req, timeout=60).read().decode("utf-8-sig")
data = json.loads(raw)
today = date.today().isoformat()

out = []
for r in data:
    end = r.get("PGM_END_DATE", "")
    if end and end < today:
        continue
    out.append({
        "name_tc": r.get("TC_PGM_NAME", ""),
        "name_en": r.get("EN_PGM_NAME", ""),
        "type_tc": r.get("TC_ACT_TYPE_NAME", ""),
        "type_en": r.get("EN_ACT_TYPE_NAME", ""),
        "district_tc": r.get("TC_DISTRICT", ""),
        "district_en": r.get("EN_DISTRICT", ""),
        "venue_tc": r.get("TC_VENUE", ""),
        "venue_en": r.get("EN_VENUE", ""),
        "start": r.get("PGM_START_DATE", ""),
        "end": r.get("PGM_END_DATE", ""),
        "time": f"{r.get('PGM_START_TIME', '')}–{r.get('PGM_END_TIME', '')}",
        "fee": r.get("FEE", ""),
        "quota": r.get("QUOTA", ""),
        "left": r.get("PLACES_LEFT", ""),
    })

out.sort(key=lambda x: x.get("start", ""))
with open("data/smartplay_activities.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print(f"smartplay: {len(out)} upcoming activities -> data/smartplay_activities.json")
