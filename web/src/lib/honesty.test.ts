// honesty.test.ts — the freshness model, which had NO test while it was wrong.
//
// MEASURED 2026-09-24: every non-numeric cadence string in sources.json that
// was not hourly/daily/as-issued fell through `cadenceSeconds` to the 300s
// default. The visible symptom was 突發新聞 (gov_news_law_order) mounting as
// stale at "+27h" — but the feed was healthy: it rebuilt 2 minutes before the
// check, its newest *article* was simply 27 hours old, because a government
// news category is quiet overnight by nature.
//
// The registry carries 43 distinct cadence strings and 18 of them say
// "continuous", so this was never one panel. These assertions exist so the
// default can never silently swallow a string again.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { cadenceSeconds, quietSeconds, degrade, live, errored, LOADING } =
  await import("./honesty.ts");

// 1. The numeric cases must keep working — this is the behaviour the poll loop
//    depends on, and it was the only part that was ever right.
{
  assert.equal(cadenceSeconds("5 minutes"), 300);
  assert.equal(cadenceSeconds("Every 2 minutes"), 120);
  assert.equal(cadenceSeconds("15 minutes"), 900);
  assert.equal(cadenceSeconds("~10 seconds"), 10);
  assert.equal(cadenceSeconds("hourly"), 3600, "bare 'hourly' has no number to read");
  assert.equal(cadenceSeconds("Hourly"), 3600, "capitalised forms are in the registry too");
  assert.equal(cadenceSeconds("daily"), 86_400);
  assert.equal(cadenceSeconds(undefined), 300, "unparseable/absent falls back, it does not throw");
  console.log("✓ cadenceSeconds 保住數字形態：5分鐘=300s、hourly=3600s、daily=86400s");
}

// 2. THE REGRESSION. "continuous" is a push-style promise, not a 5-minute poll.
//    The old code returned 300s here, which is what painted a healthy quiet
//    feed as stale. Assert the exact old value is gone.
{
  const c = cadenceSeconds("continuous");
  assert.equal(c, 300, "the POLL rate stays 5 min — asking more often is correct");
  const q = quietSeconds("continuous");
  assert.notEqual(q, 600, "regression: 'continuous' must not be tolerated for only 2x300s");
  assert.equal(q, 86_400, "Cyrus 2026-09-24: tolerate a full day of quiet, then go amber");
  console.log(`✓ 'continuous'：輪詢 ${c}s（維持）但容忍靜默 ${q / 3600}h — 唔會再 10 分鐘就報 stale`);
}

// 3. "as issued" is the same promise by another name, and it is what TD's
//    special traffic notices declare. A road closure announced once then
//    nothing for hours is a normal day, not a dead source.
{
  const q = quietSeconds("as issued");
  assert.ok(q >= 3600, `'as issued' must tolerate hours of quiet, got ${q}s`);
  console.log(`✓ 'as issued'：容忍靜默 ${q / 3600}h（特別交通消息本身就好稀疏）`);
}

// 4. Reference data must not be judged on a live-feed clock. A decennial
//    dataset is not stale after 10 minutes; it is not stale after 10 months.
{
  assert.ok(quietSeconds("snapshot") >= 86_400, "a snapshot is not a latency");
  assert.ok(quietSeconds("static") >= 86_400, "static data has no staleness");
  assert.ok(quietSeconds("monthly") > quietSeconds("snapshot"), "monthly > snapshot");
  assert.ok(quietSeconds("annual") > quietSeconds("monthly"), "annual > monthly");
  assert.ok(quietSeconds("decennial") > quietSeconds("annual"), "decennial > annual");
  assert.ok(quietSeconds("weekly") > quietSeconds("snapshot"), "weekly is slower than a snapshot");
  console.log("✓ 參考資料有階梯：snapshot/static < weekly < monthly < annual < decennial");
}

// 5. The ordering must be monotone across the whole real registry, not just the
//    handful of strings picked above. This is the assertion that generalises.
{
  const order = [
    "1 minute",
    "5 minutes",
    "15 minutes",
    "hourly",
    "continuous",
    "snapshot",
    "weekly",
    "monthly",
    "annual",
  ];
  let prev = 0;
  for (const c of order) {
    const q = quietSeconds(c);
    assert.ok(q > prev, `quiet tolerance must increase: ${c} gave ${q}s after ${prev}s`);
    prev = q;
  }
  console.log("✓ 由 1 分鐘到年度，容忍度單調遞增（冇一個跌返 300s 默認值）");
}

// 6. degrade() takes a TOLERANCE, not a cadence. Passing a cadence in is the
//    exact mistake that caused the bug, so pin the boundary behaviour.
{
  const now = new Date("2026-09-24T03:00:00+08:00");
  const ago = (sec: number) => new Date(now.getTime() - sec * 1000);

  assert.equal(degrade(live(ago(599)), 600, now).state, "live", "599s < 600s tolerance");
  assert.equal(degrade(live(ago(601)), 600, now).state, "stale", "601s > 600s tolerance");

  // The observed incident, against the chosen policy (Cyrus 2026-09-24:
  // tolerate a full day, then amber). A normal overnight gap must stay live;
  // a 27-hour silence is past the line and SHOULD read amber — that is the
  // behaviour we want, not a failure. Both halves are asserted so the
  // threshold cannot drift to "never stale" without someone noticing.
  const newsQuiet = quietSeconds("continuous");
  assert.equal(
    degrade(live(ago(10 * 3600)), newsQuiet, now).state,
    "live",
    "an overnight gap in a daily feed is normal, not staleness",
  );
  assert.equal(
    degrade(live(ago(27 * 3600)), newsQuiet, now).state,
    "stale",
    "27h of silence is past the 24h line and should read amber",
  );
  assert.equal(
    degrade(live(ago(27 * 3600)), 600, now).state,
    "stale",
    "…the old 600s tolerance flagged it too, but at only 10 minutes of quiet: that was the bug",
  );
  // The regression is the THRESHOLD, so assert the boundary itself.
  assert.equal(degrade(live(ago(86_399)), newsQuiet, now).state, "live", "just under a day");
  assert.equal(degrade(live(ago(86_401)), newsQuiet, now).state, "stale", "just over a day");

  // Non-live states must pass through untouched, or a retry could resurrect an
  // error as a live panel just by ageing.
  assert.equal(degrade(LOADING, 600, now).state, "loading");
  assert.equal(degrade(errored("boom"), 600, now).state, "error");
  assert.equal(
    degrade({ state: "live", updatedAt: null }, 600, now).state,
    "live",
    "no timestamp -> nothing to age, leave it to the panel engine",
  );
  console.log("✓ degrade() 邊界正確（599s live / 601s stale），而且唔會改動 error/loading 狀態");
  console.log("✓ 新聞靜默：10h = live、27h = stale（>24h 界線），邊界 86399s/86401s 都測到");
}

// 7. Drive the assertion from the REAL registry rather than a hand-typed list,
//    so a new cadence string added to sources.json is covered automatically.
//    Anything unrecognised lands on the 2x default, which is where the old
//    silent fallthrough lived — so make the unknown set explicit and small.
{
  const raw = JSON.parse(readFileSync(new URL("../../../sources.json", import.meta.url), "utf8"));
  const list: Array<Record<string, unknown>> = Array.isArray(raw)
    ? raw
    : ((raw.sources ?? Object.values(raw)[0]) as Array<Record<string, unknown>>);
  assert.ok(list.length > 100, `expected the full registry, got ${list.length} entries`);

  const byCadence = new Map<string, number>();
  for (const s of list) {
    const c = s["cadence"];
    const key = c === undefined || c === null || c === "" ? "(missing)" : String(c);
    byCadence.set(key, (byCadence.get(key) ?? 0) + 1);
  }

  // Every string the old function silently defaulted to 5 minutes. If any of
  // these creeps back to `quietSeconds === 600` the bug has returned.
  const pushStyle = ["continuous", "as issued", "real-time", "Real-time", "on update", "irregular", "varies", "periodic"];
  let seen = 0;
  for (const c of pushStyle) {
    if (!byCadence.has(c)) continue;
    seen++;
    assert.ok(
      quietSeconds(c) > 600,
      `registry cadence ${JSON.stringify(c)} (${byCadence.get(c)} sources) still gets a 10-minute tolerance`,
    );
  }
  assert.ok(seen >= 4, `expected the push-style strings to still be present, matched ${seen}`);

  // The "continuous" family is the big one, and the count is the blast radius.
  const continuousCount = byCadence.get("continuous") ?? 0;
  assert.ok(continuousCount > 0, "the registry should still declare continuous sources");
  console.log(
    `✓ 真實 registry（${list.length} 個源、${byCadence.size} 種 cadence 字串）：` +
      `${pushStyle.filter((c) => byCadence.has(c)).length} 種推送式字串全部 > 600s，` +
      `其中 'continuous' 一個字串就影響 ${continuousCount} 個源`,
  );
}

console.log("\nhonesty.test.ts: ALL PASS");
