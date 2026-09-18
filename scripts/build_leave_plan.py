#!/usr/bin/env python3
"""HK City Monitor — leave planner (請假攻略).

Computes the best bridge-leave combinations from the OFFICIAL holiday calendar,
instead of copying a lifestyle blog's table. Everything here is arithmetic on
verified data, so any figure it prints can be checked by hand.

Source: https://www.1823.gov.hk/common/ical/tc.json  (1823 official calendar,
general holidays, currently 2025-2027). No key, no scraping.

WHAT IT DOES
For each year it finds every run of consecutive days off (weekends plus public
holidays), then for each gap works out how many annual-leave days you would have
to spend to join that run to the next one — and ranks the joins by days-off per
leave-day. That ranking IS the 攻略: the top rows are where one leave day buys a
whole week.

USAGE
    python3 scripts/build_leave_plan.py                # all years in the feed
    python3 scripts/build_leave_plan.py --year 2026
    python3 scripts/build_leave_plan.py --json data/leave_plan.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CAL = "https://www.1823.gov.hk/common/ical/tc.json"
UA = "hk-city-monitor/0.1 (+open data client)"


def fetch_holidays() -> dict[dt.date, str]:
    req = urllib.request.Request(CAL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=40) as r:
        raw = r.read()
    # the file ships a UTF-8 BOM — json.loads chokes on it
    data = json.loads(raw.decode("utf-8-sig"))
    events = data["vcalendar"][0]["vevent"]
    out = {}
    for e in events:
        start = e["dtstart"]
        stamp = start[0] if isinstance(start, list) else start
        if isinstance(stamp, dict):
            stamp = stamp.get("value") or stamp.get("date")
        d = dt.datetime.strptime(str(stamp)[:8], "%Y%m%d").date()
        out[d] = e.get("summary", "")
    return out


def is_off(d: dt.date, holidays: dict) -> bool:
    return d.weekday() >= 5 or d in holidays


def runs(holidays: dict, year: int) -> list[tuple[dt.date, dt.date]]:
    """Maximal runs of consecutive days off, clipped to the year."""
    lo, hi = dt.date(year, 1, 1), dt.date(year, 12, 31)
    out, start = [], None
    d = lo
    while d <= hi:
        if is_off(d, holidays):
            if start is None:
                start = d
        elif start is not None:
            out.append((start, d - dt.timedelta(days=1)))
            start = None
        d += dt.timedelta(days=1)
    if start is not None:
        out.append((start, hi))
    return out


def bridges(holidays: dict, year: int):
    rs = runs(holidays, year)
    plans = []
    for i in range(len(rs) - 1):
        end, nxt = rs[i][1], rs[i + 1][0]
        gap_days = (nxt - end).days - 1                 # working days in between
        if gap_days <= 0 or gap_days > 6:               # >6 leave days is not a 攻略
            continue
        joined_days = (rs[i + 1][1] - rs[i][0]).days + 1     # to the END of the second block
        leave = gap_days
        plans.append({
            "from": rs[i][0].isoformat(), "to": rs[i + 1][1].isoformat(),
            "days_off": joined_days, "leave_days": leave,
            "efficiency": round(joined_days / leave, 2),
            "first_run": f"{rs[i][0]:%m/%d}–{rs[i][1]:%m/%d}",
            "second_run": f"{rs[i + 1][0]:%m/%d}–{rs[i + 1][1]:%m/%d}",
            "note": "公共假期／週末" if joined_days - leave > 2 else "",
        })
    return sorted(plans, key=lambda p: (-p["efficiency"], -p["days_off"])), rs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int)
    ap.add_argument("--json", help="write the plan here (e.g. data/leave_plan.json)")
    args = ap.parse_args()

    holidays = fetch_holidays()
    years = sorted({d.year for d in holidays})
    if args.year:
        years = [args.year]

    result = {}
    for y in years:
        plans, rs = bridges(holidays, y)
        result[y] = {
            "public_holidays": sum(1 for d in holidays if d.year == y),
            "days_off_runs": len(rs),
            "best_bridges": plans[:8],
        }
        print(f"=== {y} — {result[y]['public_holidays']} 日公眾假期，"
              f"{len(rs)} 段連續放假 ===")
        for p in plans[:5]:
            print(f"  {p['leave_days']} 日假 → 連續 {p['days_off']:>2} 日"
                  f"  ({p['first_run']} ＋ {p['second_run']})  效率 {p['efficiency']}")

    # self-check, written to be INDEPENDENT of the planner's own arithmetic:
    # walk the calendar day by day and confirm the claimed span really is
    # unbroken days off, and that the leave actually spent equals the working
    # days inside the gap. (An assertion that restates the formula just agrees
    # with whatever bug the formula has — this one caught exactly that.)
    import datetime as _dt
    for y, r in result.items():
        for p in r["best_bridges"]:
            a = _dt.date.fromisoformat(p["from"])
            b = _dt.date.fromisoformat(p["to"])
            span = [(a + _dt.timedelta(days=i)) for i in range((b - a).days + 1)]
            assert len(span) == p["days_off"], f"{y} {p['from']}: span != days_off"
            # the days inside the span that are NOT naturally off are exactly the
            # ones you buy with annual leave — if that count disagrees, the plan
            # is quietly asking for more leave than it admits
            paid = [d for d in span if not is_off(d, holidays)]
            assert len(paid) == p["leave_days"], \
                f"{y} {p['from']}–{p['to']}: needs {len(paid)} leave days, claimed {p['leave_days']}"
            assert paid, f"{y} {p['from']}–{p['to']}: a bridge with zero leave days is not a bridge"
            assert p["efficiency"] == round(p["days_off"] / p["leave_days"], 2)
            assert p["efficiency"] > 1.0, f"{y}: a bridge must beat taking no leave"
    print("\nself-check OK — every span is genuinely unbroken days off, "
          "and each one beats taking no leave")

    if args.json:
        path = args.json if os.path.isabs(args.json) else os.path.join(ROOT, args.json)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"source": CAL, "generated": dt.datetime.now().isoformat(timespec="seconds"),
                       "years": result}, f, ensure_ascii=False, indent=1)
        print(f"wrote {os.path.relpath(path, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
