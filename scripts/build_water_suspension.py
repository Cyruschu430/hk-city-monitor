#!/usr/bin/env python3
"""HK City Monitor — water-suspension notice builder.

WHY THIS IS A PIPELINE STEP AND NOT A PROXY CALL (measured 2026-09-19):

  esd.wsd.gov.hk — the only host publishing these notices — negotiates
  TLS_RSA_WITH_AES_128_CBC_SHA: static RSA key exchange, a suite that modern TLS
  stacks removed. Node/OpenSSL still allows it (with a relaxed security level),
  but Cloudflare's workerd/BoringSSL does not: inside the Worker, `fetch` to
  that host never completes and dies on the 10s timeout, so the proxy's answer
  is a 504. That is a platform property, not a bug we can patch in JS — which
  means the Worker CANNOT be the path for this source, in dev or in production.

  The project already has the answer for a source the browser cannot read and
  the Worker cannot reach (AGENTS.md pitfall 11, "news RSS needs the server"):
  a collector writes a static JSON the front end reads. build_cameras.py and
  build_leave_plan.py are the same shape.

  Freshness is therefore bounded by how often this runs. The front end treats
  it as it treats any source: past 2x the 5-minute cadence the panel goes amber
  (stale) and 停水模式 stops auto-hoisting on it. Run it from cron / a scheduled
  job for a live dashboard.

Run:  python3 scripts/build_water_suspension.py            # writes data/water_suspension.json
      python3 scripts/build_water_suspension.py --check    # self-check, no writes
"""
from __future__ import annotations

import json
import os
import ssl
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "data", "water_suspension.json")

URL = "https://www.esd.wsd.gov.hk/wsms_open_data/WSMS_OPEN_DATA(all).csv"
UA = {"User-Agent": "hk-city-monitor/0.2 (+open data client; github.com/Cyruschu430/hk-city-monitor)"}
HKT = timezone(timedelta(hours=8))

# The measured fact above, encoded: this host is only reachable from a client
# whose TLS stack still permits static-RSA suites.
LEGACY_CIPHERS = "DEFAULT@SECLEVEL=1"

COLUMNS = [
    "SUSPENSION_ID", "WATER_TYPE_DESCRIPTION", "WATER_TYPE_DESCRIPTION_ZHT",
    "DISTRICT_ENG", "DISTRICT_ZHT", "NATURE_DESCRIPTION", "NATURE_DESCRIPTION_ZHT",
    "SUSPENSION_DATE_TIME", "ACTUAL_RESUMPTION_DATE_TIME", "LONG_ADDRESS",
    "LONG_ADDRESS_ZHT", "CAUSE", "CAUSE_ZHT", "STATUS", "STATUS_ZHT",
]


def fetch() -> str:
    ctx = ssl.create_default_context()
    ctx.set_ciphers(LEGACY_CIPHERS)
    req = urllib.request.Request(URL, headers=UA)
    with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
        raw = r.read()
    # big5hkscs, not UTF-8 — the format that silently produces garbage if assumed.
    return raw.decode("big5hkscs", errors="replace")


def parse_hk_date(s: str) -> str | None:
    """'17-09-2026 22:00' (DD-MM-YYYY HH:mm, Hong Kong time) → ISO 8601 +08:00."""
    s = (s or "").strip()
    if len(s) < 16:
        return None
    try:
        dt = datetime.strptime(s, "%d-%m-%Y %H:%M").replace(tzinfo=HKT)
    except ValueError:
        return None
    return dt.isoformat()


def build(text: str) -> dict:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    header = lines[0].split("|")
    if header[:3] != COLUMNS[:3]:
        raise ValueError(f"unexpected header: {header[:3]}")

    records = []
    for line in lines[1:]:
        c = line.split("|")
        if len(c) < 15:
            continue
        records.append({
            "id": c[0],
            "water_type": c[2],
            "district": c[4],
            "district_en": c[3],
            "nature": c[6],
            "suspend_at": parse_hk_date(c[7]),
            "resume_at": parse_hk_date(c[8]),
            "address": c[10].rstrip(", "),
            "address_en": c[9].rstrip(", "),
            "cause": c[12],
            "status": c[14],
        })

    active = [r for r in records if r["status"] == "現正停水"]
    now = datetime.now(HKT)
    return {
        "source": URL,
        "source_name": "水務署 臨時停水通知",
        "why_pipeline": (
            "esd.wsd.gov.hk only offers static-RSA TLS (AES128-SHA), which the "
            "Cloudflare Worker's BoringSSL refuses; a browser cannot read it either "
            "(no CORS). This file is the collector's output."
        ),
        "license_note": "Open data published by the Water Supplies Department; addresses are as published.",
        "generated": now.isoformat(timespec="seconds"),
        "cadence_note": "Upstream updates every 5 minutes; this file is as fresh as the last collector run.",
        "counts": {"records": len(records), "active": len(active)},
        "districts": sorted({r["district"] for r in records if r["district"]}),
        "records": records,
        "active_ids": [r["id"] for r in active],
    }


def main() -> int:
    check = "--check" in sys.argv
    text = fetch()
    data = build(text)

    print(f"fetched {len(text)} chars (Big5 → {len(data['records'])} records)")
    if data["counts"]["active"] == 0:
        print("⚠️  0 現正停水 — possible, but check before believing a quiet feed")
    print(f"active: {data['counts']['active']}  districts: {len(data['districts'])}")

    if check:
        ok = data["counts"]["records"] > 0 and len(data["districts"]) >= 15
        print("self-check OK" if ok else "self-check FAILED")
        return 0 if ok else 1

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")

    for r in data["records"]:
        if r["status"] == "現正停水":
            print(f"  · {r['district']} {r['address'][:52]} ({r['water_type']}·{r['nature']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
