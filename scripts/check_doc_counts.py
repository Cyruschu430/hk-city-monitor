#!/usr/bin/env python3
"""check_doc_counts.py - fail if a public document states a count the registries contradict.

README.md said "24 panels" while `data/panels.json` held 25. Nothing caught it. The
counts in prose are the one place a registry change does not reach, and a wrong one
is the kind of claim this project bans everywhere else.

This checks the phrasings the documents actually use, in Markdown prose and in the
landing page's stat row. It is a guard, not a proof: a figure written a way the
patterns below do not recognise is simply not checked, but a recognised figure that
contradicts a registry fails.

Run: python3 scripts/check_doc_counts.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DOCS = ("README.md", "SELF_HOSTING.md", "TECH_SPEC.md", "docs/index.html")

# What each word in the prose is claiming. Keys are the singular forms.
CLAIMED = {
    "panel": "panels",
    "source": "sources",
    "data source": "sources",
    "layer": "layers",
    "map layer": "layers",
    "mode": "modes",
    "vertical": "modes",
}

# Markdown prose: "180 sources", "25 panels", "17 map layers".
PROSE = re.compile(
    r"([0-9][0-9,]*)\s+(panels?|data sources?|sources?|map layers?|layers?|modes?|verticals?)\b",
    re.I,
)
# docs/index.html stat row: <span class="n mono">180</span><span class="l">data sources</span>
STAT = re.compile(r'class="n mono">([0-9,]+)</span>\s*<span class="l">([a-z ]+)</span>', re.I)


def truth() -> dict[str, int]:
    def n(path: str, key: str) -> int:
        return len(json.loads((ROOT / path).read_text(encoding="utf-8"))[key])

    return {
        "sources": n("sources.json", "sources"),
        "panels": n("data/panels.json", "panels"),
        "layers": n("data/layers.json", "layers"),
        "modes": n("data/verticals.json", "verticals"),
    }


def check(text: str, where: str, counts: dict[str, int], bad: list[str], seen: list[int]) -> None:
    for match in list(PROSE.finditer(text)) + list(STAT.finditer(text)):
        raw, word = match.group(1), match.group(2).strip().lower()
        subject = CLAIMED.get(word.rstrip("s") if word.endswith("s") else word)
        if not subject:
            continue
        claimed = int(raw.replace(",", ""))
        actual = counts[subject]
        seen[0] += 1
        if claimed != actual:
            line = text.count("\n", 0, match.start()) + 1
            bad.append(f"{where}:{line}  says {claimed} {word}, registry has {actual}")


def main() -> int:
    counts = truth()
    bad: list[str] = []
    seen = [0]

    for name in DOCS:
        path = ROOT / name
        if path.exists():
            check(path.read_text(encoding="utf-8"), name, counts, bad, seen)

    print(f"registries: " + ", ".join(f"{v} {k}" for k, v in counts.items()))
    print(f"counted {seen[0]} figure(s) across {len(DOCS)} document(s)")

    if bad:
        print("\nCONTRADICTED:")
        for line in bad:
            print("  " + line)
        print("\na count in a public document no longer matches its registry. "
              "fix the document, or fix the registry - not this check.")
        return 1

    print("OK - every recognised figure matches its registry")
    return 0


if __name__ == "__main__":
    sys.exit(main())
