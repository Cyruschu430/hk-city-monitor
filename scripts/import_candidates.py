#!/usr/bin/env python3
"""HK City Monitor — promote mined catalogue entries into sources.json.

Takes the machine-readable, regularly-refreshed datasets found by
`mine_datasets.py` (Tier A by default: realtime / minutely / hourly) and appends
them to the source registry so the probe can test them for real.

These arrive as CATALOGUE tier, not core tier. The distinction matters: a core
source backs a panel or a map layer and someone has looked at it; a catalogue
source is known-good plumbing that proves breadth and is there for whoever forked
this to build on. Nothing here is wired into the UI by being imported.

Imported entries are deliberately terse and marked `auto`. Personalising 60
one-line notes would be inventing information; the probe supplies the facts.

USAGE
    python3 scripts/import_candidates.py --dry-run     # show what would be added
    python3 scripts/import_candidates.py               # add Tier A and report
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REGISTRY = os.path.join(ROOT, "sources.json")
CANDIDATES = os.path.join(ROOT, "data", "dataset_candidates.json")
CACHE = "/tmp/hkcm-ckan-cache.json"

MACHINE = {"json", "csv", "xml", "geojson", "geopackage", "gpkg", "kml", "gml"}
TIER_A = ("realtime", "minutely", "hourly")

# Datasets that are machine-readable and technically refreshed, but that nobody
# opens a monitor to see. Keeping them out is the whole point of having a list.
BLOCK = re.compile(r"recruitment|vacanc|examination schedule|tender|procurement|"
                   r"seafarer|company directory|talent pool", re.I)

GROUPS = [
    (r"observatory", "weather"), (r"transport|highways", "transport"),
    (r"immigration", "border"), (r"marine", "marine"),
    (r"airport|civil aviation", "aviation"),
    (r"observatory|environmental protection", "weather"),
    (r"lands", "geospatial"),
    (r"monetary|financial", "market"),
    # bus / ferry / tram / rail operators are transport even though their
    # organisation names are company names, not departments
    (r"\bbus\b|ferry|tram|rail|metro|new lantao", "transport"),
    (r"information services|digital policy|efficiency", "civic"),
]


def group_for(org: str) -> str:
    for pat, g in GROUPS:
        if re.search(pat, org or "", re.I):
            return g
    return "civic"


def best_url(resources: list[dict]) -> tuple[str, list[str]]:
    """First non-template machine-readable URL, preferring a Chinese variant.

    Templates like /route/{region} are skipped as the primary because the probe
    would only ever record a 404 for them; any remaining ones are kept as
    candidates so the template shapes are still discoverable in the catalogue.
    """
    usable, templates = [], []
    for r in resources or []:
        fmt = (r.get("format") or "").strip().lower()
        url = (r.get("url") or "").strip()
        if fmt not in MACHINE or not url.startswith("http"):
            continue
        if "{" in url or "<" in url:
            templates.append(url)
            continue
        usable.append(url)
    if not usable:
        return "", templates
    chinese = [u for u in usable if re.search(r"_tc|/hk/|_zht|\btc\b", u, re.I)]
    primary = (chinese or usable)[0]
    rest = [u for u in usable if u != primary][:3] + templates[:2]
    return primary, rest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--tier", choices=["A", "AB"], default="A")
    args = ap.parse_args()

    registry = json.load(open(REGISTRY, encoding="utf-8"))
    cand = json.load(open(CANDIDATES, encoding="utf-8"))["candidates"]
    cache = {d["name"]: d for d in json.load(open(CACHE, encoding="utf-8"))}

    have = {s["id"] for s in registry["sources"]}
    have_urls = {s["url"] for s in registry["sources"]}
    for s in registry["sources"]:
        have_urls.update(s.get("candidates") or [])

    bands = set(TIER_A) | ({"daily", "weekly"} if args.tier == "AB" else set())
    added, skipped = [], Counter()

    for c in cand:
        if c["band"] not in bands:
            skipped["band"] += 1
            continue
        if BLOCK.search(c["title"] or ""):
            skipped["not-a-monitor"] += 1
            continue
        ds = cache.get(c["id"])
        if not ds:
            skipped["no-cache"] += 1
            continue
        url, rest = best_url(ds.get("resources") or [])
        if not url or url in have_urls:
            skipped["duplicate-or-empty"] += 1
            continue

        slug = re.sub(r"[^a-z0-9]+", "_", c["id"].lower()).strip("_")[:48]
        n = 2
        sid = f"ck_{slug}"
        while sid in have:
            sid = f"ck_{slug}_{n}"
            n += 1

        added.append({
            "id": sid,
            "group": group_for(c["org"]),
            "name": c["title"][:120],
            "type": "dataset",
            "url": url,
            "candidates": rest,
            "auth": "none",
            "cadence": c["frequency"],
            "todo": False,
            # ponytail: terse on purpose — the probe writes the facts, and inventing
            # 60 hand-written notes would be padding, not knowledge.
            "auto": True,
            "notes": f"Auto-imported from the CKAN full scan (catalogue tier, unreviewed) · "
                     f"{c['org']} · {c['id']}",
        })
        have.add(sid)
        have_urls.add(url)

    print(f"tier {args.tier}: {len(added)} to add, skipped {dict(skipped)}")

    if not added:
        print("nothing to do")
        return 0

    # self-check: the registry's one promise is that every URL is fetchable as-is
    for a in added:
        assert a["url"].startswith("http"), a["id"]
        assert not re.search(r"[{<]", a["url"]), f"{a['id']} carries a URL template"
    assert len({a["url"] for a in added}) == len(added), "duplicate URL inside this import"
    assert len({a["id"] for a in added}) == len(added), "duplicate id inside this import"
    print("self-check OK — no templates, no duplicates")
    print("by group:", dict(Counter(a["group"] for a in added)))

    if args.dry_run:
        for a in added[:15]:
            print(f"  [{a['group']:<10}] {a['name'][:58]:<58} {a['cadence'][:22]:<22} {a['url'][:60]}")
        print(f"  … and {max(0, len(added) - 15)} more")
        return 0

    registry["sources"].extend(added)
    with open(REGISTRY, "w", encoding="utf-8") as f:
        json.dump(registry, f, ensure_ascii=False, indent=2)
    print(f"sources.json: {len(registry['sources'])} sources")
    return 0


if __name__ == "__main__":
    sys.exit(main())
