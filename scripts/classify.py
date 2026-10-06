#!/usr/bin/env python3
"""classify.py — where each registry source BELONGS: the map, a panel, both, or nowhere.

WHY THIS EXISTS. The registry has 177 entries and `coverage.py` answers "is this wired?", which is the
wrong question to plan from. The right one, from 2026-09-27:

    "有啲嘢未必係真係地圖嚟㗎嘛… 有啲可能係資訊性嘅嘢未必真係需要一個 layer 囉 … 最緊要就係分清楚邊啲
     擺落去地圖係有用嘅，個 spatial relation 輸入特別有關係"

The measured evidence agrees with him. World Monitor ships **86 panels and 11 map layers** — an 8:1
ratio. Their panels mostly never touch the map. Wiring a source to a layer because it HAS coordinates is
how a map ends up with 100 layers and reads as noise; coordinates are necessary for a layer and nowhere
near sufficient.

THE RULE, stated once so the classification below can be argued with:

  LAYER  needs BOTH
           · a geometry (point / line / polygon / continuous field), AND
           · a spatial question the map answers and a table cannot — "where", "near what",
             "how does this vary across the territory".
  PANEL  is right when either is missing:
           · no geometry at all (an index, a count, an aggregate, a time series), or
           · geometry exists but is constant — a city-wide AQHI number is ONE value; drawing it as a
             point asserts a precision the reading does not have.
  BOTH   when the panel and the map are two views of one dataset and a reader would move between them
         (water suspension: a list of notices AND the pins; neither alone is the whole answer).
  NONE   is a real answer. A registry entry that is a duplicate, a superseded endpoint, an HTML page
         rather than data, or a PDF has no placement, and saying so is better than a thin panel.

HOW THE VERDICT IS MADE, AND WHAT IT IS NOT. This is a HEURISTIC over the registry's own fields
(`type`, `group`, `notes`, `url`) plus the surfaces already built. It is a FIRST PASS to argue with, not
a measurement: the registry does not record whether a payload carries coordinates, so "LAYER?" here
means "the signals suggest spatial", not "it has geometry". Every verdict carries the signal that
produced it, and `NEEDS-EYES` marks the ones the signals cannot separate.

    python3 scripts/classify.py              # summary by placement
    python3 scripts/classify.py --list       # every source with its verdict and signal
    python3 scripts/classify.py --json       # machine-readable
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# A source whose payload is a DOCUMENT rather than data has no placement, whatever else it looks like.
DOC = re.compile(r"\.(pdf|xls|xlsx|doc|docx|ppt)(\?|$)", re.I)
# A registry entry that says it replaces or duplicates another one.
SUPERSEDED = re.compile(r"superseded|duplicate", re.I)

# Signals that a payload is spatial. Deliberately about the FIELD NAMES and the claim, not the group:
# a transport source can be a fleet-wide count and a civic source can be a facility layer.
GEO_WORDS = re.compile(
    r"座標|經緯|coordinates?\b|lat(itude)?\b|lon(gitude)?\b|geojson|geometry|"
    r"位置|地點|設施|車站|測站|站點|碼頭|口岸|管制站|路段|路線|邊界|範圍|"
    r"location|facility|station|terminal|berth|boundary|extent|bbox",
    re.I,
)
# Signals that a payload is a number about a place rather than a thing at a place.
AGG_WORDS = re.compile(
    r"統計|指數|總計|總數|平均|比率|百分比|排名|走勢|歷年|"
    r"statistic|index|total|average|rate|percentage|ranking|trend|historical",
    re.I,
)
# A time series is answered by a chart, not by a map.
SERIES_WORDS = re.compile(r"time.?series|hourly|daily|monthly|每小時|每日|每月|時間序列|走勢", re.I)


def load() -> tuple[dict, dict, dict]:
    src = json.loads((ROOT / "sources.json").read_text(encoding="utf-8"))
    by_id = {s["id"]: s for s in src["sources"]}

    def read(p: str, key: str) -> dict:
        f = ROOT / p
        if not f.exists():
            return {}
        try:
            return {x["source"]: x for x in json.loads(f.read_text(encoding="utf-8"))[key] if x.get("source")}
        except Exception:
            return {}

    # A source already drawn on the map, or already rendered by a panel, is evidence in itself.
    return by_id, read("data/panels.json", "panels"), read("data/layers.json", "layers")


def verdict(s: dict, in_panel: bool, in_layer: bool) -> tuple[str, str]:
    """(placement, signal). Ordered from the most certain tests to the least."""
    blob = " ".join(str(s.get(k) or "") for k in ("url", "notes", "name", "name_en", "kind", "type"))
    geoms = re.search(r"geom|geometry", str(s.get("notes") or ""), re.I)

    if DOC.search(str(s.get("url") or "")):
        return "NONE", "payload is a document (PDF/XLS), not data"
    if SUPERSEDED.search(blob):
        return "NONE", "registry says superseded or duplicate"

    if in_layer and in_panel:
        return "BOTH", "already wired as both a layer and a panel"
    if in_layer:
        return "LAYER", "already wired as a layer"
    if in_panel:
        # A panel alone is not a verdict — it may also deserve pins. Say so.
        return ("PANEL+", "already a panel; check whether its rows carry locations") if geoms or GEO_WORDS.search(blob) else ("PANEL", "already a panel")

    has_geo, has_agg, has_series = bool(GEO_WORDS.search(blob)), bool(AGG_WORDS.search(blob)), bool(SERIES_WORDS.search(blob))

    if has_series and has_geo:
        return "BOTH?", "a series that also names places — chart plus map, needs eyes"
    if has_series:
        return "PANEL", "a time series: a chart answers it, not a map"
    if has_agg and not has_geo:
        return "PANEL", "an aggregate: no spatial relation to draw"
    if has_geo and not has_agg:
        return "LAYER?", "spatial signals, no aggregate signals — verify it carries geometry"
    if has_geo and has_agg:
        return "BOTH?", "both signals: likely a summary panel fed by, and drawn as, spatial features"
    return "NEEDS-EYES", "no signal either way — the registry does not record whether it has coordinates"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    by_id, panels, layers = load()
    rows = []
    for sid, s in sorted(by_id.items()):
        v, sig = verdict(s, sid in panels, sid in layers)
        rows.append({"id": sid, "group": s.get("group") or "-", "verdict": v, "signal": sig,
                     "todo": bool(s.get("todo"))})

    if args.json:
        print(json.dumps({"sources": len(rows), "rows": rows}, ensure_ascii=False, indent=1))
        return 0

    if args.list:
        for r in rows:
            flag = "TODO " if r["todo"] else "     "
            print(f"  {flag}{r['verdict']:<11}{r['id']:<34}{r['group']:<12}{r['signal']}")
        return 0

    counts: dict[str, int] = {}
    for r in rows:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    print(f"registry entries ......................... {len(rows)}")
    for k in ("LAYER", "BOTH", "LAYER?", "BOTH?", "PANEL", "PANEL+", "NEEDS-EYES", "NONE"):
        if k in counts:
            print(f"  {k:<12}{counts[k]:>4}")
    todo = [r for r in rows if r["todo"] and r["verdict"] not in ("NONE", "PANEL")]
    print(f"\nof the {sum(1 for r in rows if r['todo'])} todo sources, {len(todo)} are map-shaped:")
    for r in todo:
        print(f"  {r['verdict']:<11}{r['id']}")
    eyes = [r for r in rows if r["verdict"] == "NEEDS-EYES"]
    print(f"\n{len(eyes)} need eyes — the registry does not say whether they carry coordinates:")
    for r in eyes[:25]:
        print(f"  {r['id']}")
    if len(eyes) > 25:
        print(f"  … and {len(eyes) - 25} more")
    return 0


if __name__ == "__main__":
    sys.exit(main())
