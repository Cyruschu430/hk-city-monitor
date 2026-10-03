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
GOV = "HKSAR Government open data (data.gov.hk terms) — attribution required"
RULES: list[tuple[str, str]] = [
    (".gov.hk", GOV),
    ("data.gov.hk", GOV),
    ("gov.hk", GOV),
    # Lands Department tiles/3D — separate terms page, same attribution duty.
    ("map.gov.hk", "Lands Department (LandsD) — attribution required on the map"),
    ("geodata.gov.hk", "Lands Department (LandsD) — attribution required on the map"),
    # RTHK is a government broadcaster but publishes its own feed terms.
    ("rthk.hk", GOV),
    # Third parties with explicit, known licences.
    ("api.adsb.lol", "adsb.lol — ODbL 1.0 (commercial use permitted); OpenSky explicitly forbids live products, so it is not used"),
    ("adsb.fi", "ODbL 1.0 — attribution to adsb.fi required"),
    ("opensky-network.org", "OpenSky Network — non-commercial use; see opensky-network.org terms"),
    ("aisstream.io", "aisstream.io free tier — see the service terms"),
    ("static.data.gov.hk", GOV),
    ("api.coingecko.com", "CoinGecko free API — attribution required"),
    ("earthquake.usgs.gov", "USGS — public domain (US Government work)"),
    ("eonet.gsfc.nasa.gov", "NASA EONET — public domain (US Government work)"),
    ("api.open-meteo.com", "Open-Meteo — CC BY 4.0; the free tier is non-commercial"),
    ("query1.finance.yahoo.com", "Yahoo Finance — unofficial endpoint, personal reference only"),
    ("basemaps.cartocdn.com", "CARTO / OpenStreetMap contributors — ODbL"),
    ("openstreetmap.org", "OpenStreetMap contributors — ODbL"),
    ("hkstp.org", "HKSTP open data — see its open-data terms"),
    ("consumer.org.hk", "Consumer Council — see the website terms"),
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
    ("ha.org.hk", "Hospital Authority open data — attribution required"),
    ("hongkongairport.com", "Airport Authority Hong Kong open data — attribution required"),
    ("arcgisonline.com", "Esri — ArcGIS Online public map services (subject to the Esri Terms of Use)"),
]

# Never silently stamp a licence onto a publisher we have not checked.
UNKNOWN_NOTE = "Unverified licence — the publisher's terms need manual review"


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
