#!/usr/bin/env python3
"""Attach a `license` field to sources.json entries, by publisher.

Why a script and not an LLM or 174 hand edits: the licence of a source is a
FACT about its publisher, and publishers cluster by host. Grouping by host means
one judgement per publisher, and the mapping is written down where a reviewer
can check it against the publisher's own terms.

Only well-known terms are asserted here. Anything not confidently known is left
WITHOUT a license field rather than given a guessed one — the validator warns on
those, which is the honest outcome. A wrong licence is worse than a missing one.

Run:  python scripts/apply_licenses.py [--check]
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ROOT / "sources.json"

# host suffix -> (licence text, attribution required?)
# Kept deliberately short and factual. HKSAR departments publish under the
# Government's open-data terms (data.gov.hk), which permit free re-use with
# attribution; several department sites carry the same notice.
GOV = "HKSAR Government 開放數據（data.gov.hk 條款）— 需標明出處"
RULES: list[tuple[str, str]] = [
    (".gov.hk", GOV),
    ("data.gov.hk", GOV),
    ("gov.hk", GOV),
    # Lands Department tiles/3D — separate terms page, same attribution duty.
    ("map.gov.hk", "地政總署 Lands Department — 需於地圖標明出處"),
    ("geodata.gov.hk", "地政總署 Lands Department — 需於地圖標明出處"),
    # RTHK is a government broadcaster but publishes its own feed terms.
    ("rthk.hk", GOV),
    # Third parties with explicit, known licences.
    ("api.adsb.lol", "ODbL 1.0 — 需標明 adsb.lol 出處"),
    ("adsb.fi", "ODbL 1.0 — 需標明 adsb.fi 出處"),
    ("opensky-network.org", "OpenSky Network — 非商業用途；見 opensky-network.org 條款"),
    ("aisstream.io", "aisstream.io 免費層 — 見服務條款"),
    ("static.data.gov.hk", GOV),
    ("api.coingecko.com", "CoinGecko 免費 API — 需標明出處"),
    ("earthquake.usgs.gov", "USGS — 公共領域（美國政府作品）"),
    ("eonet.gsfc.nasa.gov", "NASA EONET — 公共領域（美國政府作品）"),
    ("api.open-meteo.com", "Open-Meteo — CC BY 4.0，非商業免費層"),
    ("query1.finance.yahoo.com", "Yahoo Finance — 非官方端點，僅供個人參考"),
    ("basemaps.cartocdn.com", "CARTO / OpenStreetMap contributors — ODbL"),
    ("openstreetmap.org", "OpenStreetMap contributors — ODbL"),
    ("hkstp.org", "HKSTP 開放數據 — 見其開放數據條款"),
    ("consumer.org.hk", "消費者委員會 — 見網站條款"),
    ("hkemobility.gov.hk", GOV),
    ("1823.gov.hk", GOV),
    ("info.gov.hk", GOV),
    ("lcsd.gov.hk", GOV),
    ("censtatd.gov.hk", GOV),
    ("mardep.gov.hk", GOV),
    ("immd.gov.hk", GOV),
    ("sb.gov.hk", GOV),
    ("hkfsd.gov.hk", GOV),
    ("als.gov.hk", GOV),
    ("hkma.gov.hk", GOV),
    # Public bodies that publish their own open-data terms rather than sitting
    # under the .gov.hk umbrella. Attribution duty is the same.
    ("ha.org.hk", "醫院管理局 Hospital Authority 開放數據 — 需標明出處"),
    ("hongkongairport.com", "香港機場管理局 開放數據 — 需標明出處"),
    ("arcgisonline.com", "Esri World Imagery — 見 Esri 使用條款（僅作後備底圖）"),
]

# Never silently stamp a licence onto a publisher we have not checked.
UNKNOWN_NOTE = "未確認授權 — 需人手核對來源條款"


def licence_for(url: str) -> str | None:
    host = (urlparse(url).hostname or "").lower()
    if not host:
        return None
    for suffix, text in RULES:
        if host == suffix or host.endswith(suffix):
            return text
    return None


def detect_indent(raw: str) -> int:
    """Read the file's own indent width instead of assuming one.

    This matters: the first version of this script hardcoded 1-space and
    rewrote a 2-space file, turning a 165-line change into a 2988-line diff
    that buried the actual edit. Detect, do not assume.
    """
    for line in raw.splitlines():
        if line.startswith(" ") and line.strip():
            return len(line) - len(line.lstrip(" "))
    return 2


def main() -> int:
    raw = io.open(SOURCES, encoding="utf-8").read()
    indent = detect_indent(raw)
    doc = json.loads(raw)
    srcs = doc["sources"] if isinstance(doc, dict) else doc

    check = "--check" in sys.argv
    added, unknown, already = 0, [], 0

    for s in srcs:
        if s.get("license"):
            already += 1
            continue
        text = licence_for(s.get("url", ""))
        if text is None:
            unknown.append((s.get("id"), urlparse(s.get("url", "")).hostname))
            continue
        if not check:
            s["license"] = text
        added += 1

    if not check and added:
        io.open(SOURCES, "w", encoding="utf-8", newline="\n").write(
            json.dumps(doc, ensure_ascii=False, indent=indent) + "\n"
        )

    verb = "would add" if check else "added"
    print(f"license: {verb} {added} · already had {already} · unknown {len(unknown)} (indent={indent})")
    if unknown:
        print("\nNo licence asserted (left blank on purpose — a wrong licence is worse than none):")
        for sid, host in unknown:
            print(f"  · {sid}  ({host})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
