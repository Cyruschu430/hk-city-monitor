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
import time
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

# MEASURED 2026-10-01 against the public model list (openrouter.ai/api/v1/models needs no key):
# 462 models, 16 end in `:free`, and only 6 of those support `response_format` - which this script
# needs, because the panel renders fields rather than prose. The id this file originally carried
# (`deepseek/deepseek-chat-v3.1:free`) DOES NOT EXIST, so the first run would have died on a 400.
#
# A CHAIN, not a model. The first live run answered HTTP 429 - "temporarily rate-limited upstream,
# upstream_provider_shared_pool" - which is what the free tier is: a shared pool that is sometimes
# busy at the moment a cron fires. Retrying one model at 08:00 does not help; falling through the
# list does, and the output records which model actually answered rather than the one we asked for
# (a brief attributed to a model that did not write it is the kind of claim this project bans).
MODEL_CHAIN = (
    "qwen/qwen3.8-27b:free",  # Chinese-native, JSON, 262k ctx
    "google/gemma-4-31b-it:free",
    "google/gemma-4-26b-a4b-it:free",
)
# Three more free models supported `response_format` on paper and returned an EMPTY body in
# practice (nemotron-3-super, dots-3-note-preview, lfm-2.5): measured 2026-10-01, all three came
# back with "did not return JSON: " and no content at all. They are out of the chain - a model
# that answers nothing costs a round-trip and hides the one that would have answered.
#
# ROUNDS because the pool is shared. The same measurement: all three remaining models answered
# HTTP 429 "temporarily rate-limited upstream, upstream_provider_shared_pool" at once, at 14:10
# UTC. A cron that fires at 08:00 or 20:00 HKT will sometimes land on a busy pool, so the job
# waits and tries the whole chain again rather than failing on the first pass. The ceiling is
# named: ROUNDS x len(MODEL_CHAIN) requests, ~2 minutes worst case, and NO brief is published
# when every attempt fails - the previous file stays and shows its own age, which is the honest
# degradation this project uses everywhere else.
ROUNDS = 2
ROUND_SLEEP_S = 20
DEFAULT_MODEL = MODEL_CHAIN[0]

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


def call_model(model: str, context: str, key: str) -> dict:
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
        detail = exc.read().decode(errors="replace")[:200]
        # 429 (the shared free pool is busy) and 5xx (the provider hiccuped) are the model's
        # problem, not ours - try the next one. A 4xx that is NOT 429 is ours: a key that is not
        # allowed to call this model, or a malformed request. Retrying those six times would turn
        # a one-line configuration error into a mystery, so they stop the run.
        if exc.code == 429 or exc.code >= 500:
            raise _Busy(f"HTTP {exc.code}: {detail}") from exc
        raise SystemExit(f"OpenRouter HTTP {exc.code} for {model}: {detail}")
    text = (payload["choices"][0]["message"]["content"] or "").strip()
    if text.startswith("```"):
        text = text.strip("`").split("\n", 1)[-1].rsplit("```", 1)[0]
    try:
        out = json.loads(text)
    except json.JSONDecodeError as exc:
        raise _Busy(f"did not return JSON: {text[:200]}") from exc
    if not out.get("tc") or not out.get("en"):
        raise _Busy(f"incomplete brief: {out}")
    return out


class _Busy(Exception):
    """The model was unavailable or unusable - try the next one."""


def ask_chain(context: str) -> tuple[dict, str, list[str]]:
    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key:
        raise SystemExit(
            "OPENROUTER_API_KEY is not set. Add it as a repository secret:\n"
            "  gh secret set OPENROUTER_API_KEY --repo Cyruschu430/hk-city-monitor\n"
            "The script refuses to write a brief without one rather than publishing an empty panel."
        )
    # HKCM_AI_MODEL, when set, is tried FIRST and the chain follows: a repo variable can point at a
    # new model the day the old one dies, without a commit.
    chain = list(dict.fromkeys([m for m in [os.environ.get("HKCM_AI_MODEL") or ""] if m] + list(MODEL_CHAIN)))
    tried: list[str] = []
    for rnd in range(1, ROUNDS + 1):
        if rnd > 1:
            print(f"  round {rnd}: waiting {ROUND_SLEEP_S}s for the shared pool", file=sys.stderr)
            time.sleep(ROUND_SLEEP_S)
        for model in chain:
            try:
                return call_model(model, context, key), model, tried
            except _Busy as exc:
                tried.append(f"round {rnd} {model}: {exc}")
                print(f"  busy {model}: {exc}", file=sys.stderr)
    raise SystemExit("every model in the chain was unavailable:\n  " + "\n  ".join(tried))


def brief_age_hours(payload: dict) -> float | None:
    """Hours since the published brief was generated, or None when it cannot be read."""
    try:
        when = datetime.fromisoformat(str(payload["generated"]))
    except (KeyError, ValueError):
        return None
    return (datetime.now(HKT) - when).total_seconds() / 3600


def published_brief() -> dict | None:
    try:
        req = urllib.request.Request(f"{LIVE_BASE}/ai_summary.json", headers={"User-Agent": "hkcm-ai-brief"})
        with urllib.request.urlopen(req, timeout=20) as res:
            return json.loads(res.read().decode())
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError):
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/ai_summary.json")
    ap.add_argument("--dry-run", action="store_true", help="print the context and stop")
    ap.add_argument("--offline", action="store_true", help="ignore the live-data branch")
    ap.add_argument(
        "--skip-if-fresh",
        type=float,
        default=0.0,
        metavar="HOURS",
        help="exit 0 without calling the model when the published brief is younger than this",
    )
    ap.add_argument("--self-test", action="store_true", help="assert the freshness rule and exit")
    args = ap.parse_args()

    if args.self_test:
        # The freshness rule, asserted rather than trusted: a brief from now is fresh, one from
        # eight hours ago is not, and an unreadable timestamp is not fresh either (unknown must
        # never read as "no need to work").
        now = datetime.now(HKT)
        assert brief_age_hours({"generated": now.isoformat()}) is not None
        assert brief_age_hours({"generated": (now - timedelta(hours=8)).isoformat()}) > 6.0
        assert brief_age_hours({"generated": "not a date"}) is None
        assert brief_age_hours({}) is None
        print("SELF-TEST OK  freshness rule holds (fresh / 8h-old / unreadable / missing)")
        return 0

    if args.skip_if_fresh > 0:
        prev = published_brief()
        age = brief_age_hours(prev) if prev else None
        if age is not None and age < args.skip_if_fresh:
            # The pool is shared and sometimes busy (a whole chain answered 429 at 14:11 UTC on
            # 2026-10-01). The cron therefore fires more often than the brief should be rebuilt:
            # an attempt that finds a recent brief leaves it alone, so the PUBLISHED frequency
            # stays the two a day that were reported, while a failed attempt gets another chance
            # half an hour later instead of losing the slot entirely.
            print(f"skip     published brief is {age:.1f}h old (< {args.skip_if_fresh}h) - nothing to do")
            return 0

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
    brief, model, tried = ask_chain(context)
    if tried:
        print(f"note    {len(tried)} model(s) were busy first")
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
