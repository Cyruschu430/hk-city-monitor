#!/usr/bin/env python3
"""coverage.py — how much of the registry actually reaches the screen.

WHY THIS EXISTS. AGENTS.md says "do not quote a coverage number from memory, re-run the count" —
and until now there was nothing to re-run. The numbers in docs/SOURCE_COVERAGE_REVIEW.md were
produced by a throwaway script that was not kept, so the only way to refresh them was to rewrite
the measurement. A rule that says "re-run it" against a tool that no longer exists is a rule that
gets ignored, and the number then drifts in the one direction nobody notices: down.

WHAT IT ANSWERS, in the order a reader asks:

  1. How many registry ids reach a user?  (a panel, a layer, a vertical trigger, or a params
     sub-key that names a second source)
  2. How many have a runtime adapter, i.e. could render at all?
  3. How many are referenced by something shipped or by tooling?
  4. How many are referenced by NOTHING?

The fourth number is the one that looks alarming and is not, on its own. "Referenced by nothing" is
a fact about the CONFIGURATION, not about the source: a source can be perfectly good and simply not
be wired to anything yet. §2 and §3 of SOURCE_COVERAGE_REVIEW.md separate the two, and this script
deliberately does not guess which is which — it counts what the tree says.

    python3 scripts/coverage.py            # summary
    python3 scripts/coverage.py --list     # plus every unreferenced id, by group
    python3 scripts/coverage.py --json     # machine-readable
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARAMS_SUBKEYS = ("list_source", "expand", "fallback_source")

# Where "referenced by shipped code" is looked for. Backups are excluded — a .bak-* file naming an
# id is not the product using it, and including them is how a dead source keeps a live-looking count.
CODE_DIRS = ["web/src", "worker/src", "scripts", "web/scripts"]
SKIP_SUFFIXES = (".bak",)


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def as_list(doc, *keys):
    for k in keys:
        if isinstance(doc, dict) and k in doc:
            return doc[k]
    return doc if isinstance(doc, list) else []


def walk_sources(node, out: set[str]) -> None:
    """Collect every `"source"` string anywhere in a vertical's trigger tree."""
    if isinstance(node, dict):
        s = node.get("source")
        if isinstance(s, str):
            out.add(s)
        for v in node.values():
            walk_sources(v, out)
    elif isinstance(node, list):
        for v in node:
            walk_sources(v, out)


def adapters() -> set[str]:
    """The keys of the ADAPTERS object — the map that decides whether a panel can render.

    Extracted by brace-matching the object literal rather than a regex over the whole file: the
    value is a set of METHOD SHORTHANDS (`async td_carpark_vacancy(src, panel, ctx) {`), and a
    file-wide regex also catches unrelated helpers with the same shape. Measured: the naive version
    returned 2 of 24.
    """
    text = (ROOT / "web" / "src" / "lib" / "adapters.ts").read_text(encoding="utf-8")
    start = text.find("const ADAPTERS")
    if start < 0:
        raise SystemExit("ADAPTERS not found in web/src/lib/adapters.ts — did it get renamed?")
    i = text.find("{", start)
    depth, j = 0, i
    while j < len(text):
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    return set(re.findall(r"^\s{2}(?:async\s+)?([A-Za-z_]\w*)\s*\(", text[i + 1:j], re.M))


def code_text() -> str:
    out = []
    for d in CODE_DIRS:
        p = ROOT / d
        if not p.is_dir():
            continue
        for f in p.rglob("*"):
            if not f.is_file() or f.suffix in SKIP_SUFFIXES or ".bak-" in f.name:
                continue
            try:
                out.append(f.read_text(encoding="utf-8", errors="replace"))
            except OSError:
                pass
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="list every unreferenced id, by group")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    sources = as_list(load(ROOT / "sources.json"), "sources")
    ids = [s["id"] for s in sources]
    group_of = {s["id"]: s.get("group", "") for s in sources}
    fetch_of = {s["id"]: s.get("fetch", "") for s in sources}

    panels = as_list(load(ROOT / "data" / "panels.json"), "panels")
    layers = as_list(load(ROOT / "data" / "layers.json"), "layers")
    verticals = as_list(load(ROOT / "data" / "verticals.json"), "verticals")

    panel_src = {p["source"] for p in panels if p.get("source")}
    layer_src = {l["source"] for l in layers if l.get("source")}
    param_src = {v for p in panels for k, v in (p.get("params") or {}).items()
                 if k in PARAMS_SUBKEYS and isinstance(v, str)}
    trigger_src: set[str] = set()
    walk_sources(verticals, trigger_src)

    visible = panel_src | layer_src | param_src | trigger_src
    ads = adapters()
    text = code_text()
    referenced = {i for i in ids if re.search(r"(?<![\w])" + re.escape(i) + r"(?![\w])", text)}
    orphan = [i for i in ids if i not in referenced and i not in ads and i not in visible]

    result = {
        "sources": len(ids),
        "user_visible": len(visible & set(ids)),
        "adapters": len(ads & set(ids)),
        "referenced_by_code": len(referenced & set(ids)),
        "shipped_or_built": len((referenced | ads | visible) & set(ids)),
        "orphan": len(orphan),
        "panels_defined": len(panels),
        "layers_defined": len(layers),
        "verticals_defined": len(verticals),
        "orphan_by_group": {},
        "orphan_ids": sorted(orphan),
    }
    by_group: dict[str, int] = {}
    for i in orphan:
        by_group[group_of.get(i, "")] = by_group.get(group_of.get(i, ""), 0) + 1
    result["orphan_by_group"] = dict(sorted(by_group.items(), key=lambda kv: -kv[1]))

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    print(f"sources.json entries ......................... {result['sources']}")
    print(f"user-visible (panel | layer | trigger | param) {result['user_visible']}")
    print(f"runtime adapters implemented ................. {result['adapters']}")
    print(f"named by web/src | worker/src | scripts ...... {result['referenced_by_code']}")
    print(f"SHIPPED OR BUILT (any of the above) .......... {result['shipped_or_built']}")
    print(f"REFERENCED BY NOTHING ........................ {result['orphan']}")
    print(f"  panels {result['panels_defined']} · layers {result['layers_defined']} · verticals {result['verticals_defined']}")
    print("\nunreferenced, by group:")
    for g, n in result["orphan_by_group"].items():
        print(f"  {n:>3}  {g or '(no group)'}")

    if args.list:
        print("\nunreferenced ids:")
        for g in result["orphan_by_group"]:
            sub = sorted(i for i in orphan if group_of.get(i, "") == g)
            print(f"\n[{g or '(no group)'}] {len(sub)}")
            for i in sub:
                print(f"  {i}   fetch={fetch_of.get(i, '?')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
