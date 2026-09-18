#!/usr/bin/env python3
"""HK City Monitor — mine the data.gov.hk catalogue.

data.gov.hk runs on CKAN, which exposes a search API that returns datasets WITH
their resource URLs in bulk. So instead of opening 3,820 web pages we page through
the API and classify everything locally.

WHAT IT KEEPS
A dataset only matters to a MONITOR if it actually changes. So the filter is:

  1. at least one machine-readable resource (JSON / CSV / XML / GeoJSON / GeoPackage)
  2. a declared update_frequency that means "refreshes regularly"
     — realtime / minutely / hourly / daily / weekly / monthly by default;
       annual and irregular are counted but excluded unless --include-annual

Static gazetteers, one-off reports and annual digests are deliberately dropped:
they are reference data, not something a live dashboard can show.

USAGE
    python3 scripts/mine_datasets.py                  # scan, write candidates
    python3 scripts/mine_datasets.py --include-annual  # also keep yearly data
    python3 scripts/mine_datasets.py --refresh         # ignore the local cache
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_JSON = os.path.join(ROOT, "data", "dataset_candidates.json")
OUT_MD = os.path.join(ROOT, "data", "dataset_candidates.md")
CACHE = "/tmp/hkcm-ckan-cache.json"

# data.gov.hk's package_search only indexes 539 of the 3,820 datasets (verified:
# q=*:*, q=, fq=*:* all return count=539, while package_list returns 3,820). So we
# take the id list and pull each dataset by id. Threaded, because 3,820 sequential
# requests would take a quarter of an hour.
API = "https://data.gov.hk/en-data/api/3/action"
LIST_URL = f"{API}/package_list"
SHOW_URL = f"{API}/package_show?id="
UA = "hk-city-monitor/0.1 (+open data client)"
WORKERS = 12
FIELDS = ("name", "title", "update_frequency", "organization", "resources")

MACHINE = {"json", "csv", "xml", "geojson", "geopackage", "gpkg", "xlsx", "xls", "kml", "gml"}

# update_frequency on data.gov.hk is free text, so classify rather than match exactly.
BANDS = [
    ("realtime", re.compile(r"real[\s-]?time|instant|live", re.I)),
    ("minutely", re.compile(r"\b(?:every\s*)?\d*\s*(?:min|minute)|per\s+minute", re.I)),
    ("hourly",   re.compile(r"\b(?:every\s*)?\d*\s*(?:hr|hour)|hourly|per\s+hour", re.I)),
    ("daily",    re.compile(r"daily|per\s+day|every\s+day|weekday", re.I)),
    ("weekly",   re.compile(r"weekly|per\s+week|every\s+week", re.I)),
    ("monthly",  re.compile(r"monthly|per\s+month|every\s+month", re.I)),
    ("quarterly", re.compile(r"quarter", re.I)),
    ("annual",   re.compile(r"annual|yearly|per\s+year|every\s+year", re.I)),
]
KEEP_BANDS = {"realtime", "minutely", "hourly", "daily", "weekly", "monthly", "quarterly"}


def band(freq: str) -> str:
    if not freq or not freq.strip():
        return "unknown"
    for name, pat in BANDS:
        if pat.search(freq):
            return name
    if re.search(r"as\s+(?:and\s+when|when)|irregular|when\s+there\s+is|need", freq, re.I):
        return "irregular"
    return "unknown"


def _one(ds_id: str, tries: int = 2) -> dict | None:
    """Fetch one dataset, keeping only the fields we classify on."""
    for attempt in range(tries):
        try:
            req = urllib.request.Request(SHOW_URL + urllib.parse.quote(ds_id),
                                         headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=45) as r:
                res = json.loads(r.read().decode("utf-8-sig"))["result"]
            return {k: res.get(k) for k in FIELDS}
        except Exception:                                     # noqa: BLE001 — one bad dataset must not stop the scan
            if attempt == tries - 1:
                return None
            time.sleep(0.5)
    return None


def fetch_all(refresh: bool) -> tuple[list[dict], int]:
    if not refresh and os.path.exists(CACHE):
        with open(CACHE, encoding="utf-8") as f:
            data = json.load(f)
        print(f"using cached catalogue ({len(data)} datasets) — --refresh to re-fetch")
        return data, len(data)

    req = urllib.request.Request(LIST_URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        ids = json.loads(r.read().decode("utf-8-sig"))["result"]
    print(f"  id list: {len(ids)} datasets — pulling each one ({WORKERS} workers)")

    from concurrent.futures import ThreadPoolExecutor
    out, failed, done = [], [], 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for ds_id, res in zip(ids, pool.map(_one, ids)):
            done += 1
            if res is None:
                failed.append(ds_id)
            else:
                out.append(res)
            if done % 500 == 0:
                print(f"  {done}/{len(ids)}  (ok {len(out)}, failed {len(failed)})")

    print(f"  done: {len(out)} ok, {len(failed)} failed")
    if failed:
        print(f"  failed ids (first 5): {failed[:5]}")
    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    return out, len(ids)


def machine_resources(ds: dict) -> list[dict]:
    good = []
    for res in ds.get("resources", []) or []:
        fmt = (res.get("format") or "").strip().lower()
        url = (res.get("url") or "").strip()
        if fmt in MACHINE and url.startswith("http"):
            good.append({"format": fmt, "url": url})
    return good


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--include-annual", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    print("scanning the data.gov.hk CKAN catalogue …")
    datasets, listed = fetch_all(args.refresh)
    print(f"datasets fetched: {len(datasets)} of {listed} listed")
    assert len(datasets) >= listed * 0.9, (
        f"only got {len(datasets)} of {listed} — a big shortfall means the scan is "
        f"lying about coverage, so stop rather than report a partial catalogue as complete")

    keep_bands = set(KEEP_BANDS)
    if args.include_annual:
        keep_bands.add("annual")

    counts, candidates = {}, []
    for ds in datasets:
        freq = (ds.get("update_frequency") or "").strip()
        b = band(freq)
        counts[b] = counts.get(b, 0) + 1
        res = machine_resources(ds)
        if b in keep_bands and res:
            candidates.append({
                "id": ds.get("name"),
                "title": (ds.get("title") or "").strip(),
                "org": ((ds.get("organization") or {}).get("title") or "").strip(),
                "frequency": freq,
                "band": b,
                "formats": sorted({r["format"] for r in res}),
                "n_machine_resources": len(res),
                "sample_url": res[0]["url"],
            })

    order = ["realtime", "minutely", "hourly", "daily", "weekly", "monthly", "quarterly", "annual"]
    candidates.sort(key=lambda c: (order.index(c["band"]), c["org"], c["title"]))

    print("\nfrequency bands across the whole catalogue:")
    for b in order + ["irregular", "unknown"]:
        if counts.get(b):
            print(f"  {b:<10} {counts[b]:>5}")
    print(f"\ncandidates (machine-readable AND regularly refreshed): {len(candidates)}")

    # self-check: nothing static, one-off or unparseable may survive the filter,
    # and every candidate must carry a URL the app could actually fetch.
    for c in candidates:
        assert c["band"] in keep_bands, f"{c['id']} slipped through with band {c['band']}"
        assert c["sample_url"].startswith("http"), c["id"]
        assert c["n_machine_resources"] >= 1
    assert len({c["id"] for c in candidates}) == len(candidates), "duplicate dataset ids"
    print("self-check OK — every candidate is fetchable and refreshes on a stated cadence")

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump({"listed": listed, "scanned": len(datasets), "bands": counts,
                   "candidates": candidates}, f, ensure_ascii=False, indent=1)

    with open(OUT_MD, "w", encoding="utf-8") as f:
        f.write("# data.gov.hk — 定期更新 × 機讀 dataset 候選清單\n\n")
        f.write(f"掃描 **{len(datasets)}** 個 dataset（目錄共 {listed} 個）；"
                f"符合「有機讀資源 ＋ 有定期更新」＝ **{len(candidates)}** 個。\n\n")
        f.write("> 由 `scripts/mine_datasets.py` 生成，唔好手改。\n\n")
        f.write("## 全目錄更新頻率分佈\n\n")
        for b in order + ["irregular", "unknown"]:
            if counts.get(b):
                f.write(f"- {b}: {counts[b]}\n")
        f.write("\n## 候選\n\n")
        cur = None
        for c in candidates:
            if c["band"] != cur:
                cur = c["band"]
                f.write(f"\n### {cur}\n\n")
            f.write(f"- **{c['title']}** — `{c['id']}` · {c['org']} · "
                    f"{', '.join(c['formats']).upper()} · {c['frequency']}\n")
            f.write(f"  - {c['sample_url']}\n")

    print(f"wrote data/dataset_candidates.json and data/dataset_candidates.md")
    return 0


if __name__ == "__main__":
    sys.exit(main())
