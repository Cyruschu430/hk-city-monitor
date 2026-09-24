#!/usr/bin/env python3
"""HK City Monitor — config validator. This is the acceptance gate.

Adding a vertical must not require code, so the ways a config can lie have to be
caught mechanically. This checks the three registries against each other and
against the real source list, and it FAILS LOUDLY on the specific mistake the
architecture exists to prevent: referencing something that does not exist.

Checks:
  1. every panel / layer / trigger references a real source id in sources.json
  2. every `render` is one of the 8 closed types (the anti-rework mechanism:
     you cannot invent a renderer from inside a vertical)
  3. every user-visible string carries BOTH official languages — Hong Kong's
     official languages are Traditional Chinese and English, and a half-translated
     panel is a bug, not a work-in-progress
  4. `order` matches `panels` as a set, because display order is a design decision
     that belongs written down rather than implied by array position
  5. every vertical has a `question` — a vertical that answers nothing does not ship
  6. no duplicate ids anywhere
  7. warnings (not failures) for sources that are marked todo or failed the probe

Usage: python3 scripts/validate_config.py [--quiet]
Exit code 0 = shippable.
"""
from __future__ import annotations

import json
import os
import re
import sys

# This script prints Chinese and warning glyphs. On a Windows cp1252 console
# the print() that reports a warning raised UnicodeEncodeError, so the
# validator crashed instead of validating. Measured, not theoretical.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RENDERS = {"big_number", "list", "table", "image_single", "image_wall",
           "raster_map", "gauge_grid", "status_grid"}

# Anything that bills by usage is banned outright: this is a free public project, so a
# metered key is not a budget problem, it is a "the site's popularity costs money" problem.
# Google Maps was ruled out for exactly this. The check is mechanical because the rule is.
METERED_HOSTS = re.compile(r"googleapis\.com/maps|maps\.google|bingmaps|mapbox\.com|"
                           r"api\.openai\.com|anthropic\.com/v1|azure\.com|aws\.amazon", re.I)
GEOMS = {"point", "polygon", "line", "raster", "poi", "none"}
OPS = {"exists", ">=", "<=", "==", "in"}
# Tier 1 rule ops. A superset of the trigger ops: rules also support strict
# comparisons and the baseline-aware ops.
OPS_RULES = {">=", "<=", ">", "<", "==", "!=", ">baseline", "<baseline"}
BASELINE_OPS = {">baseline", "<baseline"}
WINDOWS = {"now", "today", "7d", "season", "year"}
SCOPES = {"hk", "district", "route"}
CJK = re.compile(r"[\u3400-\u9fff]")
LATIN = re.compile(r"[A-Za-z]")

errors: list[str] = []
warnings: list[str] = []


def load(name):
    # the source registry lives at the repo root; the three registries live in data/
    p = os.path.join(ROOT, name)
    if not os.path.exists(p):
        p = os.path.join(ROOT, "data", name)
    if not os.path.exists(p):
        errors.append(f"missing file: {name}")
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def check_bilingual(label, where):
    """Both official languages, and genuinely in the right script."""
    if not isinstance(label, dict):
        errors.append(f"{where}: must be an object with tc and en, got {type(label).__name__}")
        return
    for lang in ("tc", "en"):
        v = label.get(lang)
        if not isinstance(v, str) or not v.strip():
            errors.append(f"{where}: missing {lang}")
    tc, en = label.get("tc", ""), label.get("en", "")
    if tc and not CJK.search(tc):
        warnings.append(f"{where}: tc has no Chinese characters — Traditional Chinese expected")
    if en and CJK.search(en):
        warnings.append(f"{where}: en contains Chinese characters")


def main() -> int:
    quiet = "--quiet" in sys.argv
    sources = load("sources.json")
    panels = load("panels.json")
    layers = load("layers.json")
    verticals = load("verticals.json")
    rules = load("rules.json")
    if errors:
        print("\n".join(errors))
        return 1

    src_ids = {s["id"] for s in sources["sources"]}

    # ---- cost gate: nothing that can generate a bill ----
    for s in sources["sources"]:
        if str(s.get("cost", "free")).lower() not in ("free", "none"):
            errors.append(f"source {s['id']}: cost={s.get('cost')!r} — metered sources are banned, "
                          f"a free project must not carry a key whose price scales with popularity")
        if METERED_HOSTS.search(s.get("url", "") or ""):
            errors.append(f"source {s['id']}: URL looks like a metered provider — banned (see COST.md)")

    # ---- licence traceability ----
    # A source with no confirmed licence is a warning, not an error: the field is
    # deliberately absent when the publisher's terms have not been read, and
    # blocking the build on that would push people to guess one. The point is
    # that the gap is VISIBLE.
    unlicensed = [s["id"] for s in sources["sources"] if not s.get("license")]
    if unlicensed:
        warnings.append(f"{len(unlicensed)} source(s) have no confirmed licence: "
                        + ", ".join(unlicensed[:8]) + ("…" if len(unlicensed) > 8 else ""))

    # ---- timestamped URLs must be templates ----
    # A committed literal timestamp 404s within minutes and looks like a dead
    # source (measured: hko_radar). The app substitutes {YYYYMMDDHHMM} at
    # runtime; a hardcoded date here means someone pasted a probe sample.
    stampy = re.compile(r"_(20\d{6})\d{4}\.(?:jpg|png|gif)\b")
    for s in sources["sources"]:
        url = s.get("url", "") or ""
        if stampy.search(url):
            errors.append(f"source {s['id']}: URL carries a literal timestamp — use "
                          f"{{YYYYMMDDHHMM}} and let the parser substitute it (it 404s within minutes)")

    flagged = {s["id"] for s in sources["sources"]
               if s.get("todo") or s.get("status") == "fail"}

    def check_source(sid, where):
        if sid not in src_ids:
            errors.append(f"{where}: source '{sid}' is not in sources.json")
            return
        if sid in flagged:
            warnings.append(f"{where}: source '{sid}' is flagged todo or failed its probe")

    # ---- panels / layers ----
    seen = set()
    for p in panels["panels"]:
        # No skip for comment entries: a `_comment`-only object inside this array
        # is NOT inert. It reaches the runtime registry (sources.ts passes
        # panelsJ.panels straight through) and ui/palette.ts reads p.title.tc on
        # every entry, so an id-less element throws and silently breaks ⌘K.
        # MEASURED 2026-09-24. Withdrawn panels go in the root-level
        # `_withdrawn_panels` key instead; this loop must reject anything else.
        pid = p.get("id")
        if not pid or pid in seen:
            errors.append(f"panel id missing or duplicated: {pid!r}")
        seen.add(pid)
        check_source(p.get("source"), f"panel {pid}")
        if p.get("render") not in RENDERS:
            errors.append(f"panel {pid}: render {p.get('render')!r} is not one of the 8 closed types")
        check_bilingual(p.get("title"), f"panel {pid} title")
        check_bilingual(p.get("cadence_note"), f"panel {pid} cadence_note")
        # A disclaimer is an editorial promise, so it is validated like one:
        # bilingual, and long enough to actually say something. A one-word
        # notice ("官方") would satisfy a presence check while telling the
        # reader nothing, which is the failure mode worth blocking.
        if "disclaimer" in p:
            d = p.get("disclaimer")
            check_bilingual(d, f"panel {pid} disclaimer")
            if isinstance(d, dict):
                for k in ("tc", "en"):
                    if len(str(d.get(k, "")).strip()) < 20:
                        errors.append(f"panel {pid} disclaimer.{k} is too short to be a "
                                      f"meaningful notice ({len(str(d.get(k, '')).strip())} chars, need 20+)")
        sub = (p.get("params") or {}).get("list_source") or (p.get("params") or {}).get("expand")
        if sub:
            check_source(sub, f"panel {pid} params")

    seen_l = set()
    for l in layers["layers"]:
        lid = l.get("id")
        if not lid or lid in seen_l:
            errors.append(f"layer id missing or duplicated: {lid!r}")
        seen_l.add(lid)
        check_source(l.get("source"), f"layer {lid}")
        if l.get("geom") not in GEOMS:
            errors.append(f"layer {lid}: geom {l.get('geom')!r} not in {sorted(GEOMS)}")
        check_bilingual(l.get("title"), f"layer {lid} title")
        # A point layer that is not one of the two camera walls is drawn by the
        # generic symbol path, which needs a glyph id — failing here beats
        # failing at runtime with an empty map.
        if l.get("geom") == "point" and l.get("source") not in ("td_camera_list", "hko_webcam_index"):
            if not l.get("symbol"):
                errors.append(f"layer {lid}: point 圖層需要 symbol（非相機圖層）")

    # ---- verticals ----
    seen_v = set()
    for v in verticals["verticals"]:
        vid = v.get("id")
        where = f"vertical {vid}"
        if not vid or vid in seen_v:
            errors.append(f"vertical id missing or duplicated: {vid!r}")
        seen_v.add(vid)
        check_bilingual(v.get("name"), f"{where} name")
        if "question" not in v:
            errors.append(f"{where}: no 'question' — a vertical that answers nothing must not ship")
        else:
            check_bilingual(v.get("question"), f"{where} question")

        for pidv in v.get("panels") or []:
            if pidv not in seen:
                errors.append(f"{where}: panel '{pidv}' is not defined in panels.json")
        for lidv in v.get("layers") or []:
            if lidv not in seen_l:
                errors.append(f"{where}: layer '{lidv}' is not defined in layers.json")

        order = v.get("order")
        if not order:
            errors.append(f"{where}: 'order' is required — display order must be explicit")
        elif set(order) != set(v.get("panels") or []):
            errors.append(f"{where}: 'order' {order} does not match 'panels' {v.get('panels')} (must be the same set)")

        if v.get("window") not in WINDOWS:
            errors.append(f"{where}: window {v.get('window')!r} not in {sorted(WINDOWS)}")
        if v.get("location_scope") not in SCOPES:
            errors.append(f"{where}: location_scope {v.get('location_scope')!r} not in {sorted(SCOPES)}")

        t = v.get("trigger")
        if t:
            conds = [c for k in ("all", "any") for c in (t.get(k) or [])]
            if not conds:
                errors.append(f"{where}: trigger present but empty")
            for c in conds:
                check_source(c.get("source"), f"{where} trigger")
                if c.get("op") not in OPS:
                    errors.append(f"{where}: trigger op {c.get('op')!r} not in {sorted(OPS)}")
                if not c.get("field"):
                    errors.append(f"{where}: trigger condition has no 'field'")

    # ---- Tier 1 rules ----
    # A rule is executable config: a typo'd source or op would silently never
    # fire, and a silently-dead rule is worse than a missing one because it
    # looks like coverage.
    seen_r = set()
    rule_domains = set()
    for r in rules.get("rules") or []:
        rid = r.get("id")
        where_r = f"rule {rid}"
        if not rid or rid in seen_r:
            errors.append(f"rule id missing or duplicated: {rid!r}")
        seen_r.add(rid)

        dom = r.get("domain")
        if not dom:
            errors.append(f"{where_r}: no 'domain' — Tier 2 groups by domain")
        else:
            rule_domains.add(dom)

        if r.get("severity") not in (1, 2, 3):
            errors.append(f"{where_r}: severity {r.get('severity')!r} must be 1, 2 or 3")

        check_bilingual(r.get("headline"), f"{where_r} headline")

        w = r.get("when") or {}
        check_source(w.get("source"), where_r)
        if w.get("op") not in OPS_RULES:
            errors.append(f"{where_r}: op {w.get('op')!r} not in {sorted(OPS_RULES)}")
        if not w.get("field"):
            errors.append(f"{where_r}: 'when.field' is required")
        # Threshold ops need a number; without one the rule compares against 0,
        # which fires constantly and looks like a sensitivity setting.
        if w.get("op") in OPS_RULES and w.get("op") not in ("==", "!=", ">baseline", "<baseline") and "value" not in w:
            errors.append(f"{where_r}: op {w.get('op')!r} needs a numeric 'value'")
        if "value" in w and not isinstance(w["value"], (int, float)):
            errors.append(f"{where_r}: 'value' must be numeric, got {type(w['value']).__name__}")
        # A baseline rule with value 0 would fire on every observation.
        if w.get("op") in BASELINE_OPS and isinstance(w.get("value"), (int, float)) and w["value"] <= 0:
            errors.append(f"{where_r}: baseline op needs a positive SD threshold, got {w['value']}")

    # Tier 2 needs at least two domains to ever produce a convergence, so a
    # rule set confined to one domain is a configuration that cannot work.
    if len(rule_domains) < 2:
        warnings.append(f"rules.json declares {len(rule_domains)} domain(s) — Tier 2 convergence "
                        f"needs at least 2 distinct domains to ever fire")

    # ---- report ----
    if not quiet:
        print(f"sources {len(src_ids)} (cost=free) · panels {len(seen)} · layers {len(seen_l)} · "
              f"verticals {len(seen_v)} · rules {len(seen_r)} ({len(rule_domains)} domains)")
        for w in warnings:
            print(f"  ⚠️  {w}")
        for v in verticals["verticals"]:
            q = v["question"]["tc"]
            print(f"  🟢 {v['id']:<14} {v['name']['tc']:<10} {len(v['panels'])} panel(s)  ← {q}")
    if errors:
        print(f"\n❌ {len(errors)} error(s):")
        for e in errors:
            print(f"  · {e}")
        return 1
    print(f"\n✅ config valid" + (f" ({len(warnings)} warning(s))" if warnings else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
