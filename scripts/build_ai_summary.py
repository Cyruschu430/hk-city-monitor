#!/usr/bin/env python3
r"""build_ai_summary.py - one short bilingual brief from data this project already publishes.

WHY THIS IS ALLOWED TO EXIST. AGENTS.md bans an LLM in the RUNTIME path and carves out exactly one
exception: "a future feature wants an LLM, it must be low-frequency (daily/weekly) with a small
context, and the frequency + context size get reported before it is added." Reported to Cyrus
2026-10-01, who halved the proposed frequency himself (12/24):

    runs        2/day  - cron `0 0,12 * * *` UTC = 08:00 and 20:00 HKT
    context     < 4 KB of JSON, the fields listed in SOURCES (the script fails above that)
    output      ONE static file, `data/ai_summary.json`, published to the `live-data` branch
    runtime     zero model calls. The browser fetches a JSON file like any other panel.

WHAT IT DOES NOT DO. It computes nothing. Figures go in with their publishers' own field names and
timestamps, and the model is told to summarise only what it was handed. A model that invents a
number cannot be caught by the app, so the prompt forbids it, the output carries the model id, and
every input's timestamp ships beside the prose.

MEASURED 2026-10-01, and why the first version of this file was thrown away: the field names in it
were GUESSED. `berths_total` came back 0 against a real 120-berth file, so the first brief this
script could have produced would have said "no berths are vacant" - a false statement of exactly
the kind this project bans. The shapes below are read from the files, and where a producer's
vocabulary is unknown (a berth's vacancy is `Vacancy_tc`/`Vacancy_en`, values only known at
runtime) the script reports the VALUE HISTOGRAM rather than a count it would have to guess at.

Run:
    python3 scripts/build_ai_summary.py --dry-run      # print the exact context, call nothing
    python3 scripts/build_ai_summary.py --offline      # read the committed files, not live-data
    OPENROUTER_API_KEY=... python3 scripts/build_ai_summary.py --out data/ai_summary.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

HKT = timezone(timedelta(hours=8))
ROOT = Path(__file__).resolve().parent.parent
LIVE_BASE = "https://raw.githubusercontent.com/Cyruschu430/hk-city-monitor/live-data"

# Files whose committed copy is a SNAPSHOT with a cadence: read the live branch instead, or the
# brief describes a week-old city as if it were this morning. Their names match the three files
# live_cycle.sh publishes, and the fallback is a read of the same payload - which carries the
# publisher's own timestamp, so the brief shows its age rather than hiding it.
LIVE_FILES = ("aircraft.json", "berth_vacancy.json", "water_suspension.json")

# The whole context, and the ceiling it must stay under.
SOURCES = ("aircraft.json", "berth_vacancy.json", "water_suspension.json", "carpark_info.json", "baselines.json")
MAX_CONTEXT_BYTES = 4000

DEFAULT_MODEL = "deepseek/deepseek-chat-v3.1:free"

PROMPT = """You are writing a two-sentence situational brief for a Hong Kong public-data dashboard.

RULES, in order of importance:
1. Use ONLY the numbers in DATA. Do not compute, extrapolate, or round differently, and never add
   a figure that is not there. If a number is missing, say nothing about it.
2. No advice, no predictions, no politics, no speculation about causes. Describe what the data
   shows, in the present tense.
3. Plain language a resident understands. No jargon, no "insights", no "leverage", no emoji.
4. Two sentences maximum per language, under 45 words each.
5. The data is public open data from Hong Kong government departments and public bodies.

Return ONLY JSON, no prose around it: {"tc": "<two sentences, Traditional Chinese, Cantonese register>", "en": "<two sentences in English>"}

DATA (verbatim from the publishers, with their own timestamps):
"""


def fetch(file: str) -> tuple[dict | None, str]:
    """(payload, where it came from). Live branch first for cadenced files, committed copy after."""
    if file in LIVE_FILES:
        try:
            req = urllib.request.Request(f"{LIVE_BASE}/{file}", headers={"User-Agent": "hkcm-ai-brief"})
            with urllib.request.urlopen(req, timeout=30) as res:
                return json.loads(res.read().decode()), "live-data"
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError) as exc:
            print(f"  WARN {file}: live branch unreachable ({exc}); using the committed snapshot", file=sys.stderr)
    path = ROOT / "data" / file
    if not path.exists():
        return None, "missing"
    try:
        return json.loads(path.read_text(encoding="utf-8")), "bundle"
    except (json.JSONDecodeError, OSError) as exc:
        print(f"  WARN {file}: unreadable ({exc})", file=sys.stderr)
        return None, "missing"


def slim(file: str, payload: dict) -> dict:
    """The fields worth quoting. Shapes read from the files on 2026-10-01 - see the module docstring
    for what guessing cost. A histogram replaces a count wherever the vocabulary is the producer's
    to choose."""
    if file == "aircraft.json":
        ac = payload.get("ac") or []
        # `alt_baro` is the string "ground" for an aircraft on the apron — read from the app's own
        # parser (web/src/lib/parsers.ts, `const onGround = rawAlt === "ground"`). The first version
        # of this file tested `a["ground"]`, which does not exist in the feed, and reported
        # 62 airborne / 0 on the ground against a real 49/13. Duplicating a rule is how two answers
        # to one question get shipped; the honest fix is to read the feed the way the app reads it.
        ground = [a for a in ac if a.get("alt_baro") == "ground"]
        return {
            "observed_ms": payload.get("now"),
            "aircraft": len(ac),
            "airborne": len(ac) - len(ground),
            "on_ground": len(ground),
        }
    if file == "berth_vacancy.json":
        props = [f.get("properties") or {} for f in payload.get("features") or []]
        # The producer's own words, counted. "使用中" / "Vacant" is their vocabulary; asking the
        # model to add these up itself is how a summary invents a number.
        return {
            "observed": max((p.get("LastUpdate") or "" for p in props), default=""),
            "berths": len(props),
            "by_status_tc": dict(Counter(p.get("Vacancy_tc") or "?" for p in props)),
        }
    if file == "water_suspension.json":
        counts = payload.get("counts") or {}
        return {
            "observed": payload.get("generated"),
            "active": counts.get("active", 0),
            "records": counts.get("records", 0),
            "districts": (payload.get("districts") or [])[:6],
        }
    if file == "carpark_info.json":
        return {"carparks_listed": len(payload.get("car_park") or [])}
    if file == "baselines.json":
        days = payload.get("days") or {}
        return {
            "metrics": sorted(days),
            "days_accumulated": {k: len(v) for k, v in days.items()},
        }
    return {}


def build_context(offline: bool) -> tuple[dict, list[dict], list[str]]:
    facts, inputs, warnings = {}, [], []
    for file in SOURCES:
        payload, where = (None, "offline") if offline and file in LIVE_FILES else fetch(file)
        if payload is None:
            if not offline:
                path = ROOT / "data" / file
                payload = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
            if payload is None:
                warnings.append(f"{file}: absent")
                continue
            where = "bundle"
        s = slim(file, payload)
        if not s:
            warnings.append(f"{file}: shape not recognised - slim() needs a branch for it")
            continue
        facts[file] = s
        inputs.append({"file": file, "from": where, "observed": s.get("observed") or s.get("observed_ms")})
    return facts, inputs, warnings


def ask_model(model: str, context: str) -> dict:
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key:
        raise SystemExit(
            "OPENROUTER_API_KEY is not set. Add it as a repository secret:\n"
            "  gh secret set OPENROUTER_API_KEY --repo Cyruschu430/hk-city-monitor\n"
            "The script refuses to write a brief without one rather than publishing an empty panel."
        )
    body = json.dumps(
        {
            "model": model,
            "messages": [{"role": "user", "content": PROMPT + context}],
            "max_tokens": 400,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        }
    ).encode()
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://hk-city-monitor.pages.dev",
            "X-Title": "HK City Monitor",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as res:
            payload = json.loads(res.read().decode())
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"OpenRouter HTTP {exc.code}: {exc.read().decode(errors='replace')[:400]}") from exc
    text = (payload["choices"][0]["message"]["content"] or "").strip()
    if text.startswith("```"):
        text = text.strip("`").split("\n", 1)[-1].rsplit("```", 1)[0]
    try:
        out = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"model did not return JSON: {text[:300]}") from exc
    if not out.get("tc") or not out.get("en"):
        raise SystemExit(f"model returned an incomplete brief: {out}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/ai_summary.json")
    ap.add_argument("--dry-run", action="store_true", help="print the context and stop")
    ap.add_argument("--offline", action="store_true", help="ignore the live-data branch")
    args = ap.parse_args()

    facts, inputs, warnings = build_context(args.offline)
    for w in warnings:
        print(f"  WARN {w}", file=sys.stderr)
    if not facts:
        raise SystemExit("no usable input files - run this from the repo root")
    context = json.dumps(facts, ensure_ascii=False, indent=1)
    print(f"inputs   {len(facts)} file(s) from {', '.join(sorted({i['from'] for i in inputs}))}")
    print(f"context  {len(context.encode())} bytes (ceiling {MAX_CONTEXT_BYTES})")
    if len(context.encode()) > MAX_CONTEXT_BYTES:
        raise SystemExit(
            "context grew past the reported ceiling. Do not raise the ceiling silently: the "
            "frequency and the context size were reported to Cyrus before this job was added, "
            "and AGENTS.md requires a new report when either changes."
        )
    for i in inputs:
        print(f"  {i['file']:24s} from {i['from']:9s} observed {i['observed']}")

    if args.dry_run:
        print("\n--- context the model would receive ---")
        print(context)
        print("--- end (model NOT called) ---")
        return 0

    # `or`, not a default argument: a repo variable that exists but is empty (`vars.X` when
    # unset) returns "" and would be sent as a model id.
    model = os.environ.get("HKCM_AI_MODEL") or DEFAULT_MODEL
    brief = ask_model(model, context)
    out = {
        "generated": datetime.now(HKT).isoformat(timespec="seconds"),
        "model": model,
        # On the panel: a summary a reader cannot attribute is a claim without a source, which is
        # the one thing this project does not ship.
        "provenance": {
            "generator": "LLM summary of published open data",
            "inputs": inputs,
            "frequency": "2x daily (08:00, 20:00 HKT)",
            "disclaimer": "AI-generated from the figures above. It is not analysis, not advice, and not an official notice.",
        },
        "brief": brief,
    }
    path = ROOT / args.out
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote    {args.out} ({path.stat().st_size} bytes)")
    print(f"tc       {brief['tc']}")
    print(f"en       {brief['en']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
