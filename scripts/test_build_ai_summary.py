#!/usr/bin/env python3
"""Checks the model chain degrades instead of dying.

MEASURED 2026-11-27: the paid DeepSeek key ran out of balance and answered `HTTP 402`. Because only
429 / 5xx / an edge 403 walked the chain, the run died on link #1 while four working models sat
behind it — every scheduled brief went red for five days and the panel served a five-day-old
summary. These two asserts are the difference between a fallback and a dead run; run them with
no network and no keys:

    python3 scripts/test_build_ai_summary.py
"""
import importlib.util
import io
import json
import os
import sys
import urllib.error
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("build_ai_summary", HERE / "build_ai_summary.py")
bas = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bas)                     # __main__ guard keeps this from running the job

os.environ["DEEPSEEK_API_KEY"] = "dummy-ds"
os.environ["CHATANYWHERE_API_KEY"] = "dummy-ca"
os.environ.pop("OPENROUTER_API_KEY", None)
os.environ.pop("GROQ_API_KEY", None)

# The shipped chain is FREE MODELS ONLY, so pin a two-link chain here: the point of this test is the
# MECHANISM (a dead link must walk), not which providers the project happens to use today.
bas.MODEL_CHAIN = ("ds/deepseek-chat", "ca/gpt-4o-mini")

BRIEF = {"tc": "今日數據平穩。", "en": "Conditions are calm today.",
         "spoken_tc": "今日數據平穩。", "spoken_en": "Conditions are calm today."}


def ok_response(_req, timeout=None):
    body = json.dumps({"choices": [{"message": {"content": json.dumps(BRIEF, ensure_ascii=False)}}]}).encode()
    class R:
        def read(self): return body
        def __enter__(self): return self
        def __exit__(self, *a): return False
    return R()


def fail_response(code, msg=b'{"error":{"message":"nope"}}'):
    def _f(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, code, "err", {}, io.BytesIO(msg))
    return _f


def run(urlopen):
    bas.urllib.request.urlopen = urlopen
    return bas.ask_chain("{}")


def fail_ds_only(code):
    """Fail every attempt against DeepSeek, answer normally for everyone else."""
    def _f(req, timeout=None):
        if "deepseek.com" in req.full_url:
            raise urllib.error.HTTPError(req.full_url, code, "err", {}, io.BytesIO(b'{"error":{"message":"nope"}}'))
        return ok_response(req)
    return _f


# 1. 402 (no balance) on link #1 must WALK to the next provider, not kill the run.
brief, model, tried = run(fail_ds_only(402))
assert model == "ca/gpt-4o-mini", f"402 did not walk the chain, ended on {model}"
assert not any(m["brief"] if isinstance(m, dict) else False for m in tried)
assert len(tried) == 1 and "402" in tried[0], tried

# 2. The same for 404 (a delisted :free model) — a per-model condition, not our bug.
brief, model, tried = run(fail_ds_only(404))
assert model == "ca/gpt-4o-mini", f"404 did not walk the chain, ended on {model}"

# 3. A 400 is OUR payload being wrong: it must still stop the run instead of burning six models.
try:
    run(fail_response(400))
except SystemExit as exc:
    assert "400" in str(exc), exc
else:
    raise AssertionError("400 should be fatal, but the chain swallowed it")

print("build_ai_summary: 402/404 walk the chain, 400 stays fatal — ok")
