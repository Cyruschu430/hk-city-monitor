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
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "data", "water_suspension.json")
GEOCODE_CACHE = os.path.join(ROOT, "data", "geocode_cache.json")

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
    """'17-09-2026 22:00' (DD-MM-YYYY HH:mm, Hong Kong time) -> ISO 8601 +08:00."""
    s = (s or "").strip()
    if len(s) < 16:
        return None
    try:
        dt = datetime.strptime(s, "%d-%m-%Y %H:%M").replace(tzinfo=HKT)
    except ValueError:
        return None
    return dt.isoformat()


# --- geocoding -----------------------------------------------------------------
#
# WHY HERE AND NOT IN THE BROWSER. The map used to highlight a whole DISTRICT for
# a suspension, because the WSD feed carries a district name and nothing else --
# so "停水受影響地區" painted an entire 18-district polygon red when the actual
# outage was one building. Cyrus asked for the affected LOCATIONS:
# "Layers District with water suspension should refering to Panel 水務署 臨時停水
# 通知 showing the affected locations by geocoding."
#
# ALS (`als.gov.hk/lookup`, already the registered `als_address_lookup` source) is
# the OGCIO official address lookup: keyless, and MEASURED to return both a
# normalised address AND <Latitude>/<Longitude>. Tested 2026-09-24 against eight
# real notice addresses of the messy kind this feed publishes ("甘苑 備註: 沖廁用
# 食水亦同時暫停", "田心村195-231號", "莆上村2巷16號") -- 8/8 resolved.
#
# It runs in the COLLECTOR, not the page, because:
#   1. ALS is a lookup service; hammering it once per page load is abusive.
#   2. Notices change every few minutes, so coordinates cache far longer than the
#      notice data itself.
#   3. AGENTS.md forbids an LLM on this path. ALS is a gazetteer, not a guess.
#
# HONESTY RULE: a notice that does not resolve keeps lat=null and is drawn as its
# DISTRICT, exactly as before. We never fall back to a district centroid and call
# it an address -- a confident pin in the wrong place is worse than an honest
# district highlight.


def _als_lookup(query: str) -> tuple[float, float] | None:
    """One ALS lookup. Returns (lat, lng) or None. Never raises."""
    q = query.strip()
    if not q:
        return None
    url = "https://www.als.gov.hk/lookup?q=" + urllib.parse.quote(q)
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            xml = r.read().decode("utf-8", errors="replace")
    except Exception:
        return None
    first = xml.split("<SuggestedAddress>", 1)
    if len(first) < 2:
        return None
    block = first[1]
    lat = re.search(r"<Latitude>([^<]+)</Latitude>", block)
    lng = re.search(r"<Longitude>([^<]+)</Longitude>", block)
    if not lat or not lng:
        return None
    try:
        return float(lat.group(1)), float(lng.group(1))
    except ValueError:
        return None


def _clean_for_lookup(address: str) -> str:
    """Strip what ALS cannot match; keep the part that names a place.

    The feed writes free text: a comma-separated street list, an inline note
    ("備註: ..."), and a supply qualifier prefix ("無水:"). ALS matches a single
    place, so take the FIRST clause and drop the annotations. Deliberately
    conservative -- if this yields junk the lookup simply misses and the notice
    stays district-level, which is the safe outcome.
    """
    a = address.split("備註:")[0]
    a = re.sub(r"^\s*(無水|水弱/無水|水弱)\s*[:：]\s*", "", a)
    a = a.split("、")[0].split(",")[0].split("，")[0]
    a = re.sub(r"\s*近\s*燈柱\S*.*$", "", a)
    a = re.sub(r"\s*一帶\s*$", "", a)
    return a.strip(" ,，、.")


def geocode_records(records: list[dict], *, verbose: bool = True) -> dict:
    """Attach lat/lng to every record we can resolve. Cached across runs."""
    cache: dict[str, list[float] | None] = {}
    if os.path.exists(GEOCODE_CACHE):
        try:
            with open(GEOCODE_CACHE, encoding="utf-8") as f:
                cache = json.load(f)
        except (OSError, ValueError):
            cache = {}

    hits = misses = cached_n = 0
    for r in records:
        key = _clean_for_lookup(r.get("address") or "")
        if not key:
            r["lat"] = r["lng"] = None
            misses += 1
            continue
        if key in cache:
            co = cache[key]
            cached_n += 1
        else:
            co = _als_lookup(key)
            cache[key] = list(co) if co else None
            time.sleep(0.25)  # be a polite client of a government lookup service
        if co:
            r["lat"], r["lng"] = co[0], co[1]
            hits += 1
        else:
            r["lat"] = r["lng"] = None
            misses += 1

    try:
        os.makedirs(os.path.dirname(GEOCODE_CACHE), exist_ok=True)
        with open(GEOCODE_CACHE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=0, sort_keys=True)
    except OSError:
        pass  # a cache we cannot write is a slow run, not a failed one

    if verbose:
        print(f"geocode: {hits} located, {misses} district-only ({cached_n} from cache)")
    return {"located": hits, "district_only": misses, "from_cache": cached_n}


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
    geo = geocode_records(records)
    now = datetime.now(HKT)
    active_located = sum(1 for r in active if r.get("lat") is not None)
    return {
        "source": URL,
        "source_name": "水務署 臨時停水通知",
        "why_pipeline": (
            "esd.wsd.gov.hk only offers static-RSA TLS (AES128-SHA), which the "
            "Cloudflare Worker's BoringSSL refuses; a browser cannot read it either "
            "(no CORS). This file is the collector's output."
        ),
        "license_note": "Open data published by the Water Supplies Department; addresses are as published.",
        "geocode_note": (
            "lat/lng come from the OGCIO Address Lookup Service (als.gov.hk), the "
            "registered als_address_lookup source, applied to the first clause of "
            "each notice address. A notice that did not resolve keeps lat=null and "
            "is drawn at DISTRICT level -- we never substitute a district "
            "centroid, because a confident pin in the wrong place is worse than "
            "an honest district highlight."
        ),
        "generated": now.isoformat(timespec="seconds"),
        "cadence_note": "Upstream updates every 5 minutes; this file is as fresh as the last collector run.",
        "counts": {
            "records": len(records),
            "active": len(active),
            "located": geo["located"],
            "district_only": geo["district_only"],
            "active_located": active_located,
            "active_district_only": len(active) - active_located,
        },
        "districts": sorted({r["district"] for r in records if r["district"]}),
        "records": records,
        "active_ids": [r["id"] for r in active],
    }


def main() -> int:
    # Windows consoles default to cp1252, and this script prints Chinese (the
    # district and address strings are part of its report). MEASURED 2026-09-24:
    # an arrow in a status line crashed the run with UnicodeEncodeError AFTER the
    # expensive fetch and geocode had already succeeded, so a scheduling failure
    # looked like a data failure. Reconfigure once, at the entry point, rather
    # than scrubbing every non-ASCII character out of the output.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    check = "--check" in sys.argv
    text = fetch()
    data = build(text)

    print(f"fetched {len(text)} chars (Big5 -> {len(data['records'])} records)")
    if data["counts"]["active"] == 0:
        print("WARNING: 0 active suspensions - possible, but verify a quiet feed")
    print(f"active: {data['counts']['active']}  districts: {len(data['districts'])}")

    if check:
        ok = data["counts"]["records"] > 0 and len(data["districts"]) >= 15
        # A geocoder that silently stops resolving is the failure mode that
        # matters: the map would quietly fall back to district polygons and
        # nobody would notice the pins had gone. Assert a floor, not 100%,
        # because a genuinely odd address is allowed to miss.
        located = data["counts"]["located"]
        total = data["counts"]["records"]
        coverage = located / total if total else 0
        if coverage < 0.5:
            ok = False
            print(f"self-check: geocode coverage {coverage:.0%} ({located}/{total}) below the 50% floor")
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
