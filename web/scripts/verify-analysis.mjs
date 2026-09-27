// verify-analysis.mjs — the Tier 2 timeline and co-occurrence views, over a table of scenarios.
//
// WHY A TABLE AND NOT ONE BRIEF. The first version fed a single synthetic brief and asserted the
// row count, which proves the happy path renders and nothing else. The defects that actually
// reach a reader live in the states that are awkward to construct — a group that crosses
// midnight, an event dated yesterday inside a group dated today, a district whose name is long
// enough to push the panel wide, a domain id that has no label. Every one of those is reachable
// from live data and none of them appears in a two-district sample.
//
// The views cannot be reached from live data at all yet: a baseline-aware rule needs 14 days of
// real readings before it may fire, and this deployment has 5. So without a seam the check would
// pass by never running. `window.__hkcm.feedAnalysis(brief)` is that seam — same kind of QA hook
// as clearDataCache and refreshAll — and it lets each scenario be constructed exactly.
//
// Scenarios are checked against the DOM, never against the brief that was fed. Feeding a value
// and then asserting the value proves the transport; the question is what a reader sees.

import { chromium } from "playwright-core";

// A leading `--flag` is never a URL. Treating argv[2] blindly as the base made `--shot <name>`
// navigate to "--shot" ("Cannot navigate to invalid URL") — the flag has to be excluded, not the
// positional guessed at.
const firstArg = process.argv[2];
const BASE = (firstArg && !firstArg.startsWith("--"))
  ? firstArg
  : (process.env.BASE ?? "http://127.0.0.1:4173/");
const exe = process.env.CHROME_PATH
  ?? "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";

// ── time helpers. HKT is fixed at +8 (no DST), so a wall clock converts to an instant directly.
const HKT = 8 * 3600_000;
const hkt = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h - 8, mi));
const nowH = () => new Date(Date.now() + HKT);
const minsAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();

const todayH = nowH();
const hktTodayMidnight = hkt(todayH.getUTCFullYear(), todayH.getUTCMonth() + 1, todayH.getUTCDate(), 0, 0);

/** One Tier 1 event, in the shape narrative.ts emits. */
const ev = (at, domain, severity, tc, observed, threshold) => ({
  at, domain, severity, ruleId: `${domain}_rule`, headline: { tc, en: `${domain} event` }, observed, threshold,
});
const group = (district, events, extra = {}) => ({
  district,
  domains: [...new Set(events.map((e) => e.domain))],
  events,
  score: events.length,
  maxSeverity: Math.max(...events.map((e) => e.severity), 1),
  from: events[0].at,
  to: events[events.length - 1].at,
  ...extra,
});
const brief = (groups, accumulating = []) => ({
  generatedAt: new Date().toISOString(), mode: "template",
  facts: [], convergences: [], convergenceDetail: groups, accumulating,
});

const SCENARIOS = [
  {
    name: "no convergences — the honest empty state",
    brief: brief([], [{ signal: "ha_ae_waiting", days: 5, required: 14 }]),
    check: (d) => [
      [d.groups === 0, `expected 0 groups, got ${d.groups}`],
      [d.pairs === 0, `expected 0 pairs, got ${d.pairs}`],
      [/無異常事件|No anomalies/.test(d.text), `expected the empty message, got "${d.text.slice(0, 60)}"`],
      [d.empty, "the no-anomalies message is not on screen at all"],
      [d.acc > 0, "the accumulating baselines section vanished — an empty list reads as all-clear"],
    ],
  },
  {
    name: "one district, one event — no span separator",
    brief: brief([group("沙田區", [ev(minsAgo(20), "water", 2, "臨時停水通知", 3, 2)])]),
    check: (d) => [
      [d.groups === 1, `expected 1 group, got ${d.groups}`],
      [d.rows === 1, `expected 1 row, got ${d.rows}`],
      [d.pairs === 0, `one domain cannot pair with itself, got ${d.pairs} pair(s)`],
      [!d.span.includes("–"), `a single instant must not render a span, got "${d.span}"`],
    ],
  },
  {
    name: "two districts sharing a pair — the edge counts both and names both",
    // 沙田區 and 觀塘區 BOTH have water+traffic; 觀塘區 also has health. So water|traffic is the
    // strongest edge (n=2, two districts) and the two health edges tie at n=1. The first version
    // of this scenario gave the districts DIFFERENT pairs and then asserted a pair spanned both —
    // it could not have passed, which is a test bug, and it is kept here as the corrected shape so
    // the assertion tests what it claims.
    brief: brief([
      group("沙田區", [ev(minsAgo(50), "water", 2, "停水", 3, 2), ev(minsAgo(35), "traffic", 1, "交通消息", 12, 10)]),
      group("觀塘區", [
        ev(minsAgo(45), "water", 2, "停水", 4, 2),
        ev(minsAgo(30), "traffic", 1, "交通消息", 9, 8),
        ev(minsAgo(10), "health", 3, "急症室", 180, 120),
      ]),
    ]),
    check: (d) => [
      [d.groups === 2, `expected 2 groups, got ${d.groups}`],
      [d.rows === 5, `expected 5 rows, got ${d.rows}`],
      [d.pairs === 3, `expected 3 distinct pairs, got ${d.pairs}`],
      [d.firstPairN === "2", `water+traffic occurs in both districts, so n=2, got n=${d.firstPairN}`],
      [d.firstPairDistricts.includes("沙田區") && d.firstPairDistricts.includes("觀塘區"),
        `a pair appearing in both districts must name both, got "${d.firstPairDistricts}"`],
      [d.pairOrder.every((t, i, a) => i === 0 || Number(a[i - 1].n) >= Number(t.n)), "pairs must be strongest-first"],
    ],
  },
  {
    name: "a group that crosses midnight — the span must carry the date",
    brief: brief([group("灣仔區", [
      ev(new Date(hktTodayMidnight.getTime() - 10 * 60_000).toISOString(), "water", 2, "停水", 3, 2),
      ev(new Date(hktTodayMidnight.getTime() + 30 * 60_000).toISOString(), "health", 3, "急症室", 200, 120),
    ])]),
    check: (d) => [
      [d.groups === 1, `expected 1 group, got ${d.groups}`],
      [/\d+\/\d+/.test(d.span), `a span crossing midnight must carry a date, got "${d.span}"`],
      [!d.span.includes("23:50–00:30"), `the span reads BACKWARDS — exactly the defect this checks for: "${d.span}"`],
      [d.rows === 2 && d.rowTimes[0].includes("/"), `an event dated yesterday must show its date, got "${d.rowTimes[0]}"`],
    ],
  },
  {
    name: "four domains in one district — 6 unordered pairs",
    brief: brief([group("油尖旺區", [
      ev(minsAgo(55), "water", 2, "停水", 3, 2),
      ev(minsAgo(45), "traffic", 1, "交通", 12, 10),
      ev(minsAgo(30), "health", 3, "急症室", 180, 120),
      ev(minsAgo(12), "weather", 1, "強風", 4, 3),
    ])]),
    check: (d) => [
      [d.rows === 4, `expected 4 rows, got ${d.rows}`],
      [d.pairs === 6, `4 domains make 4C2 = 6 unordered pairs, got ${d.pairs}`],
      [d.pairOrder[0].n === "1" || Number(d.pairOrder[0].n) === 1, `each pair occurs once here, got n=${d.pairOrder[0].n}`],
    ],
  },
  {
    name: "duplicate domains in one group — one edge, not one per event",
    brief: brief([group("沙田區", [
      ev(minsAgo(50), "water", 2, "停水 A", 3, 2),
      ev(minsAgo(40), "water", 2, "停水 B", 4, 2),
      ev(minsAgo(30), "traffic", 1, "交通", 12, 10),
    ])]),
    check: (d) => [
      [d.rows === 3, `expected 3 rows, got ${d.rows}`],
      [d.pairs === 1, `two water events are still ONE water+traffic edge, got ${d.pairs}`],
      [d.firstPairN === "1", `the edge spans one district, got n=${d.firstPairN}`],
    ],
  },
  {
    name: "six districts — all render, nothing overflows sideways",
    brief: brief(["沙田區", "觀塘區", "灣仔區", "油尖旺區", "深水埗區", "黃大仙區"].map((dst, i) =>
      group(dst, [ev(minsAgo(50 - i), "water", 2, "停水", 3, 2), ev(minsAgo(30 - i), "health", 2, "急症室", 150, 120)]))),
    check: (d) => [
      [d.groups === 6, `expected 6 groups, got ${d.groups}`],
      [d.rows === 12, `expected 12 rows, got ${d.rows}`],
      [!d.hOverflow, "the panel scrolls horizontally — a timeline must not need a sideways scroll"],
    ],
  },
  {
    name: "a group with no events — must not crash the panel",
    brief: brief([{ ...group("北區", [ev(minsAgo(20), "water", 2, "停水", 3, 2)]), events: [] }]),
    check: (d) => [
      [d.groups === 1, `expected the empty group to still render a heading, got ${d.groups}`],
      [d.rows === 0, `expected 0 rows, got ${d.rows}`],
      [d.pairs === 0, `no events means no pairs, got ${d.pairs}`],
      [!d.errored, "an empty group put the panel into an error state"],
    ],
  },
  {
    name: "domain ids are labelled, not printed raw",
    brief: brief([group("沙田區", [
      ev(minsAgo(30), "water", 2, "停水", 3, 2),
      ev(minsAgo(20), "health", 3, "急症室", 180, 120),
      ev(minsAgo(10), "zzz_unmapped", 1, "未對應領域", 5, 1),
    ])]),
    check: (d) => [
      [/水務/.test(d.text), `TC run must label water as 水務, got "${d.text.slice(0, 80)}"`],
      [!/(^|\s)water(\s|$|\+)/.test(d.domLine), `the domain line still prints the raw id: "${d.domLine}"`],
      [/zzz_unmapped/.test(d.text), "an unmapped domain must fall back to its own id, not disappear"],
    ],
  },
  {
    name: "a long district name does not widen the panel",
    brief: brief([group("北區打鼓嶺坪輋及恐龍坑一帶特別行政區", [
      ev(minsAgo(20), "water", 2, "停水", 3, 2), ev(minsAgo(10), "health", 2, "急症室", 150, 120),
    ])]),
    check: (d) => [
      [d.groups === 1, `expected 1 group, got ${d.groups}`],
      [!d.hOverflow, "a long district name pushed the panel into a horizontal scroll"],
    ],
  },
];

// ── DOM reads shared by every scenario.
const READ = () => {
  const p = document.querySelector('[data-panel="analysis_brief"]');
  const rows = [...(p?.querySelectorAll(".tl-ev") ?? [])];
  const pairEls = [...(p?.querySelectorAll(".pair") ?? [])];
  return {
    state: p?.dataset.state,
    groups: p?.querySelectorAll(".tl-g").length ?? 0,
    rows: rows.length,
    pairs: pairEls.length,
    span: p?.querySelector(".tl-span")?.textContent?.trim() ?? "",
    rowTimes: rows.map((r) => r.querySelector("time")?.textContent?.trim() ?? ""),
    domLine: p?.querySelector(".tl-dom")?.textContent?.trim() ?? "",
    text: p?.querySelector(".panel-body")?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    empty: !!p?.querySelector(".p-empty"),
    acc: p?.querySelectorAll(".an-acc").length ?? 0,
    errored: !!p?.querySelector(".p-error"),
    firstPairDistricts: pairEls[0]?.querySelector(".pair-d")?.textContent?.trim() ?? "",
    firstPairN: pairEls[0]?.querySelector(".pair-n")?.textContent?.trim() ?? "",
    pairOrder: pairEls.map((e) => ({
      n: e.querySelector(".pair-n")?.textContent?.trim() ?? "",
      txt: e.textContent?.replace(/\s+/g, " ").trim() ?? "",
    })),
    hOverflow: (() => {
      const b = p?.querySelector(".panel-body");
      return !!b && b.scrollWidth > b.clientWidth + 2;
    })(),
  };
};

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 150)); });

await page.goto(BASE, { waitUntil: "domcontentloaded" });
let booted = false;
for (let attempt = 1; attempt <= 2 && !booted; attempt++) {
  try {
    await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
    booted = true;
  } catch {
    if (attempt === 1) await page.goto(BASE, { waitUntil: "domcontentloaded" });
  }
}
if (!booted) {
  console.error("readiness timeout on both attempts: the app never booted, so nothing was measured.");
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(9000); // let the pipeline bind the panel before overriding it

const hasSeam = await page.evaluate(() => typeof window.__hkcm?.feedAnalysis === "function");
if (!hasSeam) {
  console.error("window.__hkcm.feedAnalysis is missing — the timeline cannot be exercised.");
  await browser.close();
  process.exit(1);
}

// `--shot <substring>` feeds the matching scenario, photographs it, and exits. A visual for a
// human is a different question from a pass/fail for a check, but it should come from the SAME
// scenario definition — otherwise the picture in a report is of a state the suite never tests.
const shotIdx = process.argv.indexOf("--shot");
if (shotIdx >= 0) {
  const want = (process.argv[shotIdx + 1] ?? "").toLowerCase();
  const s = SCENARIOS.find((x) => x.name.toLowerCase().includes(want)) ?? SCENARIOS[SCENARIOS.length - 1];
  await page.evaluate((b) => window.__hkcm.feedAnalysis(b), s.brief);
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector('[data-panel="analysis_brief"]')?.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(700);
  const out = process.env.SHOT_OUT ?? "scripts/rev/analysis.png";
  await page.screenshot({ path: out });
  console.log(`shot "${s.name}" -> ${out}`);
  await browser.close();
  process.exit(0);
}

let failed = 0;
for (const s of SCENARIOS) {
  await page.evaluate((b) => window.__hkcm.feedAnalysis(b), s.brief);
  await page.waitForTimeout(320);
  const got = await page.evaluate(READ);
  const results = s.check(got);
  const bad = results.filter(([ok]) => !ok);
  const tag = bad.length === 0 ? "PASS" : "FAIL";
  console.log(`${tag}  ${s.name}`);
  if (bad.length) {
    failed++;
    for (const [, why] of bad) console.log(`        ${why}`);
    console.log(`        got: groups=${got.groups} rows=${got.rows} pairs=${got.pairs} span="${got.span}" state=${got.state}`);
  }
}

await browser.close();
const real = consoleErrors.filter((t) => !/InvalidStateError/.test(t));
if (real.length) {
  console.log(`\n${real.length} console error(s) beyond the documented image-decode noise:`);
  for (const t of [...new Set(real)].slice(0, 5)) console.log(`  ${t}`);
  failed++;
}
console.log(`\n${failed === 0 ? "SCENARIOS OK" : `SCENARIOS FAILED: ${failed} of ${SCENARIOS.length}`}  (${SCENARIOS.length} scenarios)`);
process.exit(failed === 0 ? 0 : 1);
