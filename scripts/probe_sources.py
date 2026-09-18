#!/usr/bin/env python3
"""HK City Monitor — data source probe.

Tests every source in `sources.json` with a real HTTP request and writes two
artifacts:

  SOURCES.md                 human-readable catalogue, generated (never hand-edited)
  data/sources_report.json   machine-readable results for the app / CI

Why this exists: a dashboard is only as honest as its sources. Every URL the app
fetches must have been requested for real, with the result recorded. Run this
after changing sources.json, and in CI before a deploy.

Usage:
  python3 scripts/probe_sources.py              # probe everything, write reports
  python3 scripts/probe_sources.py --only weather
  python3 scripts/probe_sources.py --check       # probe, print, write nothing
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REGISTRY = os.path.join(ROOT, "sources.json")
REPORT_JSON = os.path.join(ROOT, "data", "sources_report.json")
REPORT_MD = os.path.join(ROOT, "SOURCES.md")

UA = "hk-city-monitor/0.1 (+https://github.com/; open-data client)"
TIMEOUT = 30
MAX_BYTES = 4 * 1024 * 1024          # ponytail: hard cap so one huge feed can't stall the probe

# data.gov.hk ships some files with odd encodings and some gov sites have stale
# chains; a bare urllib context refuses them, so relax verification but keep TLS.
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

OK, WARN, BAD = "🟢", "🟡", "🔴"
ICONS = {"ok": OK, "fail": BAD, "unprobeable": WARN,
         "wrong-payload": BAD, "needs-params": WARN}


def fetch(url: str) -> dict:
    started = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=CTX) as r:
            body = r.read(MAX_BYTES)
            return {
                "ok": True,
                "status": r.status,
                "final_url": r.geturl(),
                "content_type": (r.headers.get("Content-Type") or "").split(";")[0].strip(),
                "bytes": len(body),
                "ms": int((time.time() - started) * 1000),
                "body": body,
            }
    except urllib.error.HTTPError as e:
        return {"ok": False, "status": e.code, "error": f"HTTP {e.code}", "ms": int((time.time() - started) * 1000)}
    except Exception as e:                                    # noqa: BLE001 — probe must never crash on one bad source
        return {"ok": False, "status": 0, "error": f"{type(e).__name__}: {e}", "ms": int((time.time() - started) * 1000)}


def shape(kind: str, body: bytes, ctype: str) -> str:
    """One-line description of what actually came back — enough to tell a real
    payload from a 200-and-an-error-page, which is the classic gov-site trap."""
    if not body:
        return "empty body"
    text = None
    for enc in ("utf-8", "utf-16", "big5", "latin-1"):
        try:
            text = body.decode(enc)
            break
        except (UnicodeDecodeError, LookupError):
            continue
    if text is None:
        return f"binary {len(body)}B"

    if kind == "json" or "json" in ctype:
        try:
            d = json.loads(text)
        except json.JSONDecodeError:
            return f"declared JSON but unparseable (starts {text[:40]!r})"
        if isinstance(d, list):
            return f"JSON array, {len(d)} items"
        if isinstance(d, dict):
            keys = ", ".join(list(d)[:6])
            return f"JSON object, keys: {keys}"
        return f"JSON {type(d).__name__}"

    if kind == "csv":
        rows = list(csv.reader(io.StringIO(text), delimiter="\t" if "\t" in text[:2000] else ","))
        head = ", ".join(rows[0][:6]) if rows else "(no header)"
        return f"CSV ~{max(len(rows) - 1, 0)} rows, cols: {head}"

    if kind in ("xml", "rss") or "xml" in ctype:
        items = len(re.findall(r"<item[\s>]", text, re.I))
        tags = re.findall(r"<([A-Za-z_][\w:.-]*)", text)[:5]
        return f"XML, {items} <item> entries, root tags: {', '.join(dict.fromkeys(tags))}"

    if kind == "image":
        return f"image {len(body)}B"

    # html
    if "<html" in text[:2000].lower():
        title = re.search(r"<title[^>]*>(.*?)</title>", text, re.S | re.I)
        return f"HTML page — title: {(title.group(1).strip()[:60] if title else 'n/a')}"
    return f"{len(body)}B of {ctype or 'unknown type'}"


def is_probeable(url: str) -> bool:
    return url.startswith(("http://", "https://"))


def classify(kind: str, ctype: str, shape_text: str) -> tuple[bool, str]:
    """A 200 is not success. Gov sites answer 200 with HTML error pages and with
    bodies like 'Please include valid parameters'. Treat those as unresolved, or
    the catalogue lies about what the app can actually fetch."""
    if "Please include valid parameters" in shape_text:
        return False, "endpoint exists but rejects these parameters (wrong dataType / missing args)"
    if "unparseable" in shape_text:
        return False, "200 but the body is not parseable as declared"
    if kind == "json" and "json" not in ctype and not shape_text.startswith("JSON"):
        return False, "200 but not JSON (likely an HTML page or a wrong path)"
    if kind in ("xml", "rss") and "HTML page" in shape_text:
        return False, "200 but HTML, not XML"
    if kind == "csv" and "HTML page" in shape_text:
        return False, "200 but HTML, not CSV"
    return True, ""


def probe(src: dict) -> dict:
    out = {
        "id": src["id"], "group": src["group"], "name": src["name"],
        "type": src.get("type", ""), "auth": src.get("auth", "none"),
        "cadence": src.get("cadence", ""), "notes": src.get("notes", ""),
        "todo": bool(src.get("todo")),
    }
    urls = [u for u in [src.get("url", "")] + list(src.get("candidates") or []) if u]
    probeable = [u for u in urls if is_probeable(u)]

    if not probeable:
        out.update(status="unprobeable", working_url="", http_status=0,
                   detail="not an HTTP endpoint (websocket or still unknown)")
        return out

    tried = []
    for u in probeable:
        r = fetch(u)
        if r["ok"]:
            sh = shape(out["type"], r["body"], r["content_type"])
            good, why = classify(out["type"], r["content_type"], sh)
            out.update(status="ok" if good else "wrong-payload",
                       working_url=r["final_url"], http_status=r["status"],
                       content_type=r["content_type"], bytes=r["bytes"], ms=r["ms"], shape=sh)
            if not good:
                out["detail"] = why
            out["tried"] = tried
            return out
        err = r.get("error") or str(r.get("status"))
        tried.append(f"{u} -> {err}")
        # 405/422 mean the endpoint is real but wants a different method or body
        if r.get("status") in (405, 422):
            out.update(status="needs-params", working_url=u, http_status=r["status"],
                       detail=f"{r['status']} — endpoint exists, needs POST body/parameters", tried=tried)
            return out

    out.update(status="fail", working_url="", http_status=0, detail="; ".join(tried), tried=tried)
    return out


def write_markdown(results: list[dict]) -> None:
    groups = ["cameras", "weather", "transport", "border", "aviation", "marine",
              "civic", "prices", "news", "market", "geospatial", "global"]
    seen = {r["group"] for r in results}
    groups += sorted(seen - set(groups))

    ok = sum(1 for r in results if r["status"] == "ok")
    lines = [
        "# SOURCES.md — 已實測數據源目錄",
        "",
        "> **本檔案由 `scripts/probe_sources.py` 自動生成，唔好手改。**",
        "> 改源 → 改 `sources.json` → 跑 `python3 scripts/probe_sources.py`。",
        "",
        f"最後實測：`{time.strftime('%Y-%m-%d %H:%M %Z')}`　·　"
        f"**{ok} / {len(results)} 個源成功**",
        "",
        "每個 URL 都真係發過 HTTP 請求。🟢 = 200 而且回傳真數據　🟡 = 未解決／要 key　🔴 = 失敗。",
        "",
    ]
    for g in groups:
        rows = [r for r in results if r["group"] == g]
        if not rows:
            continue
        lines += [f"## {g}", "", "| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |",
                  "|---|---|---|---|---|---|"]
        for r in rows:
            icon = ICONS.get(r["status"], WARN)
            if r["status"] == "ok" and r["todo"]:
                icon = WARN                       # resolved but not yet wired into the app
            url = r.get("working_url") or r.get("detail") or "—"
            url = url if len(url) < 90 else url[:87] + "…"
            lines.append(f"| {r['name']} | `{url}` | {icon} {r['status']} | "
                         f"{r['cadence'] or '—'} | {r['auth']} | {r.get('shape') or '—'} |")
        lines.append("")
        for r in rows:
            if r.get("notes"):
                lines.append(f"- **{r['name']}** — {r['notes']}")
        lines.append("")

    unresolved = [r for r in results if r["status"] != "ok" or r["todo"]]
    lines += ["## 未解決 / 待辦", ""]
    if unresolved:
        for r in unresolved:
            lines.append(f"- `{r['id']}` — {r['name']} → {r.get('detail') or r.get('shape') or 'still a candidate URL'}")
    else:
        lines.append("（無）")
    lines.append("")
    with open(REPORT_MD, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="probe only this group")
    ap.add_argument("--check", action="store_true", help="print results, write nothing")
    args = ap.parse_args()

    with open(REGISTRY, encoding="utf-8") as f:
        srcs = json.load(f)["sources"]
    if args.only:
        srcs = [s for s in srcs if s["group"] == args.only]
    if not srcs:
        print("no sources selected")
        return 1

    results = []
    for s in srcs:
        r = probe(s)
        results.append(r)
        icon = ICONS[r["status"]]
        print(f"{icon} {r['id']:<26} {r['status']:<11} {r.get('shape') or r.get('detail') or ''}")

    # Non-trivial logic, so it gets a check: a run where nothing at all resolved
    # means the probe (or the network) is broken, not the sources.
    ok = [r for r in results if r["status"] == "ok"]
    assert len(results) == len(srcs), "probe lost or duplicated a source"
    if not ok:
        print("\nNOTE: zero sources reachable — suspect the network/env, not the sources.")
    print(f"\n{len(ok)}/{len(results)} reachable")

    if args.check:
        return 0
    os.makedirs(os.path.dirname(REPORT_JSON), exist_ok=True)
    with open(REPORT_JSON, "w", encoding="utf-8") as f:
        json.dump({"probed_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "results": results}, f,
                  ensure_ascii=False, indent=1)
    write_markdown(results)
    print(f"wrote {os.path.relpath(REPORT_JSON, ROOT)} and {os.path.relpath(REPORT_MD, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
