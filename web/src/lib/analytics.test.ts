// analytics.test.ts — Tier 0/1/2 acceptance, per ANALYTICS.md.
//
// These run OFFLINE on synthetic input. That is deliberate: the properties being
// tested (determinism, the 14-day gate, "no causal wording") are properties of
// the FUNCTIONS, and a test that needed the network could not assert them
// reliably. Real-payload behaviour is exercised by the browser harness.

import assert from "node:assert/strict";

(globalThis as Record<string, unknown>)["localStorage"] = {
  getItem: () => null,
  setItem: () => {},
};

const B = await import("./analytics/baseline.ts");
const R = await import("./analytics/rules.ts");
const C = await import("./analytics/convergence.ts");
const N = await import("./analytics/narrative.ts");
const A = await import("./analytics/index.ts");

// Types must come from a static import: a dynamic `await import()` binding is a
// value, not a namespace, so `R.RuleDef` as a type annotation does not typecheck.
import type { RuleDef, Event } from "./analytics/rules.ts";

const HK = (iso: string) => new Date(iso);

// --- Tier 0: the 14-day gate -------------------------------------------------
{
  const store = B.emptyStore();
  // 13 days of a steady 10. Not mature: 13 < 14.
  let s = store;
  for (let d = 0; d < 13; d++) {
    s = B.observe(s, "sig", 10, HK(`2026-09-${String(d + 1).padStart(2, "0")}T08:00:00+08:00`));
  }
  const m13 = B.maturity(s, "sig");
  assert.equal(m13.days, 13, "13 distinct days counted");
  assert.equal(m13.mature, false, "13 days is NOT mature");
  assert.equal(B.baselineFor(s, "sig", HK("2026-09-14T08:00:00+08:00")), null, "immature -> null baseline");

  // The 14th day flips it.
  s = B.observe(s, "sig", 10, HK("2026-09-14T08:00:00+08:00"));
  const m14 = B.maturity(s, "sig");
  assert.equal(m14.days, 14, "14 distinct days");
  assert.equal(m14.mature, true, "14 days IS mature");
  assert.notEqual(B.baselineFor(s, "sig", HK("2026-09-15T08:00:00+08:00")), null, "mature -> baseline");

  // Many observations on ONE day is still one day — otherwise a burst of polls
  // would fake maturity in an afternoon.
  let burst = B.emptyStore();
  for (let i = 0; i < 500; i++) {
    burst = B.observe(burst, "sig", 5, HK("2026-09-01T08:00:00+08:00"));
  }
  assert.equal(B.daysObserved(burst, "sig"), 1, "500 same-day observations = 1 day");
  assert.equal(B.maturity(burst, "sig").mature, false, "a burst cannot fake maturity");

  console.log(`\u2713 Tier 0 閘：13 日唔夠（baseline=null）· 14 日先開 · 同日 500 次都只算 1 日`);
}

// --- Tier 0: determinism ------------------------------------------------------
{
  // Same input, twice -> identical output. This is the property the whole
  // pipeline's auditability rests on.
  const build = () => {
    let s = B.emptyStore();
    const vals = [3, 5, 8, 2, 9, 4, 7, 1, 6, 5, 3, 8, 2, 4];
    vals.forEach((v, i) => {
      s = B.observe(s, "sig", v, HK(`2026-09-${String(i + 1).padStart(2, "0")}T14:00:00+08:00`));
    });
    return s;
  };
  const a = build();
  const b = build();
  assert.deepEqual(a, b, "same input -> byte-identical store");

  // And purity: the input store is not mutated.
  const before = JSON.stringify(a);
  B.observe(a, "sig", 999, HK("2026-09-20T14:00:00+08:00"));
  assert.equal(JSON.stringify(a), before, "observe() does not mutate its input");

  // NaN must not poison a bucket.
  const withNaN = B.observe(a, "sig", NaN, HK("2026-09-20T14:00:00+08:00"));
  assert.deepEqual(withNaN, a, "NaN refused, store unchanged");

  console.log(`\u2713 Tier 0 決定性：兩次跑 byte 相同 · observe() 唔改輸入 · NaN 被拒`);
}

// --- Tier 0: buckets are per weekday+hour, and sd is real ---------------------
{
  let s = B.emptyStore();
  // Monday 08:00 gets 100s; Monday 09:00 gets 1s. If bucketing were broken these
  // would blur together and the mean would be ~50.
  //
  // Spread across 20 DISTINCT Mondays: the maturity gate would otherwise return
  // null and this test would be asserting nothing (it caught exactly that on the
  // first run — the lesson being that a Tier 0 test must satisfy the Tier 0 gate
  // before it can test anything else). Mondays step in whole weeks from a known
  // Monday, so the dates cannot silently collide.
  const monday = Date.UTC(2026, 0, 5, 0, 0); // 2026-01-05 is a Monday
  for (let week = 0; week < 20; week++) {
    const d = new Date(monday + week * 7 * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    s = B.observe(s, "sig", 100, HK(`${iso}T08:00:00+08:00`));
    s = B.observe(s, "sig", 1, HK(`${iso}T09:00:00+08:00`));
  }
  assert.equal(B.daysObserved(s, "sig"), 20, "20 distinct Mondays recorded");
  const at8 = B.baselineFor(s, "sig", HK("2026-01-05T08:00:00+08:00"));
  const at9 = B.baselineFor(s, "sig", HK("2026-01-05T09:00:00+08:00"));
  assert.ok(at8 && at9, `both buckets have baselines (days=${B.daysObserved(s, "sig")})`);
  assert.equal(at8.mean, 100, "08:00 bucket mean = 100");
  assert.equal(at9.mean, 1, "09:00 bucket mean = 1 (separate bucket)");
  // A constant series has sd 0, and z must then be 0 rather than Infinity.
  assert.equal(at8.sd, 0, "constant series -> sd 0");
  assert.equal(B.zScore(500, at8), 0, "sd 0 -> z 0, not Infinity");

  console.log(`\u2713 Tier 0 分桶：08:00 同 09:00 分開（mean 100 vs 1）· 常數序列 sd=0 → z=0`);
}

// --- Tier 1: hit and miss -----------------------------------------------------
{
  const rules: RuleDef[] = [
    {
      id: "ae_long",
      domain: "health",
      severity: 2,
      when: { source: "ha_ae_waiting", field: "longestWaitMin", op: ">=", value: 120 },
      headline: { tc: "急症室輪候過長", en: "A&E wait long" },
    },
  ];
  const store = B.emptyStore();

  const hit = R.evaluate(rules, { state: { ha_ae_waiting: { longestWaitMin: 150 } }, store, now: HK("2026-09-23T10:00:00+08:00") });
  assert.equal(hit.events.length, 1, "150 >= 120 fires");
  assert.equal(hit.events[0]!.observed, 150, "observed value recorded");
  assert.equal(hit.events[0]!.threshold, 120, "threshold recorded");

  const miss = R.evaluate(rules, { state: { ha_ae_waiting: { longestWaitMin: 45 } }, store, now: HK("2026-09-23T10:00:00+08:00") });
  assert.equal(miss.events.length, 0, "45 does not fire");

  // A missing value must NOT be treated as 0 — ">= 0" style rules would then
  // fire on every source that has not answered yet.
  const absent = R.evaluate(rules, { state: {}, store, now: HK("2026-09-23T10:00:00+08:00") });
  assert.equal(absent.events.length, 0, "absent source -> no event");

  const zeroish: RuleDef[] = [
    { id: "z", domain: "x", severity: 1, when: { source: "s", field: "missing", op: ">=", value: 0 }, headline: { tc: "x", en: "x" } },
  ];
  const zeroEval = R.evaluate(zeroish, { state: { s: {} }, store, now: HK("2026-09-23T10:00:00+08:00") });
  assert.equal(zeroEval.events.length, 0, "unresolvable path is skipped, not read as 0");

  // `.length` works on arrays and objects, and a numeric STRING counts (these
  // government feeds publish numbers as strings).
  assert.equal(R.numericAt({ a: [1, 2, 3] }, "a.length"), 3, "array length");
  assert.equal(R.numericAt({ a: { x: 1, y: 2 } }, "a.length"), 2, "object key count");
  assert.equal(R.numericAt({ a: "18" }, "a"), 18, "numeric string coerced");
  assert.equal(R.numericAt({ a: "N/A" }, "a"), null, "'N/A' is not a number");

  console.log(`\u2713 Tier 1：150 命中 / 45 唔中 · 缺值唔當 0 · .length 同數字字串都讀到`);
}

// --- Tier 1: a baseline rule cannot fire before maturity ----------------------
{
  const rules: RuleDef[] = [
    {
      id: "spike",
      domain: "water",
      severity: 2,
      when: { source: "wsd_water_suspension", field: "records_fresh.length", op: ">baseline", value: 2 },
      headline: { tc: "停水宗數異常", en: "Unusual suspension count" },
    },
  ];

  // Immature store: a wild value must produce NO event, and the caller must be
  // TOLD why (so the UI can say "累積中 · 已 X 日 / 14 日").
  const r1 = R.evaluate(rules, {
    state: { wsd_water_suspension: { records_fresh: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] } },
    store: B.emptyStore(),
    now: HK("2026-09-23T10:00:00+08:00"),
  });
  assert.equal(r1.events.length, 0, "baseline rule does not fire while immature");
  assert.equal(r1.immature.length, 1, "the immature rule is reported, not silent");
  assert.equal(r1.immature[0]!.maturity.required, 14, "required days surfaced");

  console.log(`\u2713 Tier 1 基線閘：未夠 14 日 → 0 事件，但回報「累積中 ${r1.immature[0]!.maturity.days}/14 日」`);
}

// --- Tier 1: severity ordering ------------------------------------------------
{
  const rules: RuleDef[] = [
    { id: "lo", domain: "a", severity: 1, when: { source: "s", field: "v", op: ">=", value: 1 }, headline: { tc: "低", en: "low" } },
    { id: "hi", domain: "b", severity: 3, when: { source: "s", field: "v", op: ">=", value: 1 }, headline: { tc: "高", en: "high" } },
    { id: "mid", domain: "c", severity: 2, when: { source: "s", field: "v", op: ">=", value: 1 }, headline: { tc: "中", en: "mid" } },
  ];
  const res = R.evaluate(rules, { state: { s: { v: 5 } }, store: B.emptyStore(), now: HK("2026-09-23T10:00:00+08:00") });
  assert.deepEqual(res.events.map((e) => e.severity), [3, 2, 1], "highest severity first");
  console.log(`\u2713 Tier 1 排序：severity ${res.events.map((e) => e.severity).join(" > ")}`);
}

// --- Tier 2: convergence, and the no-causation rule ---------------------------
{
  const mk = (domain: string, district: string, min: number, severity: 1 | 2 | 3): Event => ({
    ruleId: `${domain}-r`,
    domain,
    severity,
    headline: { tc: "x", en: "x" },
    observed: 1,
    threshold: 1,
    district,
    at: HK(`2026-09-23T${String(10 + Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00+08:00`),
    baselineAware: false,
    z: null,
  });

  // Three domains in one district inside 40 minutes -> one convergence.
  const conv = C.findConvergence([mk("water", "沙田區", 0, 2), mk("traffic", "沙田區", 20, 1), mk("health", "沙田區", 40, 3)]);
  assert.equal(conv.length, 1, "one group");
  assert.equal(conv[0]!.district, "沙田區", "district recorded");
  assert.deepEqual([...conv[0]!.domains].sort(), ["health", "traffic", "water"], "3 domains");
  // score = domains*3 + maxSeverity*2 + count = 9 + 6 + 3 = 18
  assert.equal(conv[0]!.score, 18, `score = 3*3 + 3*2 + 3 = 18 (got ${conv[0]!.score})`);

  // One domain is not convergence, however many events.
  const single = C.findConvergence([mk("water", "灣仔區", 0, 3), mk("water", "灣仔區", 10, 3), mk("water", "灣仔區", 20, 3)]);
  assert.equal(single.length, 0, "a single domain never converges");

  // Outside the 60-minute window -> separate groups, each with 1 domain -> none.
  const apart = C.findConvergence([mk("water", "東區", 0, 2), mk("traffic", "東區", 90, 2)]);
  assert.equal(apart.length, 0, "events 90 min apart do not group at window=60");

  // Events with no district are excluded — Tier 2's claim is geographic.
  const nowhere = C.findConvergence([
    { ...mk("water", "", 0, 2), district: null },
    { ...mk("traffic", "", 10, 2), district: null },
  ]);
  assert.equal(nowhere.length, 0, "no district -> no geographic claim");

  // THE WORDING RULE. Asserted on the ONLY phrasing function, so a future edit
  // that introduces causal language fails here rather than on a screenshot.
  const textTc = C.describeConvergence(conv[0]!, "tc");
  const textEn = C.describeConvergence(conv[0]!, "en");
  assert.ok(textTc.includes("同時發生"), `tc text says co-occurrence: ${textTc}`);
  for (const causal of ["因為", "導致", "造成", "due to", "because", "caused", "led to"]) {
    assert.ok(!textTc.includes(causal) && !textEn.includes(causal), `no causal wording (${causal})`);
  }

  console.log(`\u2713 Tier 2 匯聚：3 領域同區 → score ${conv[0]!.score}（3×3+3×2+3）· 單一領域唔算 · 60 分鐘窗外唔算`);
  console.log(`    措辭：${textTc}`);
}

// --- Tier 3/4: the template fallback is the primary path ----------------------
{
  const events: Event[] = [
    {
      ruleId: "ae_wait_long",
      domain: "health",
      severity: 2,
      headline: { tc: "急症室輪候超過兩小時", en: "A&E wait over two hours" },
      observed: 180,
      threshold: 120,
      district: "沙田區",
      at: HK("2026-09-23T10:00:00+08:00"),
      baselineAware: false,
      z: null,
    },
  ];
  const conv = C.findConvergence([
    { ...events[0]!, domain: "health" },
    { ...events[0]!, ruleId: "water_active", domain: "water", severity: 2 },
  ]);
  const immature = [{ ruleId: "spike", source: "wsd_water_suspension", maturity: { mature: false, days: 5, required: 14 } }];

  // The brief must exist with NO LLM present. That is the whole contract: the
  // feature works when the narrative provider is dead.
  const brief = N.templateBrief(events, conv, immature, HK("2026-09-23T10:05:00+08:00"), "tc");
  assert.equal(brief.mode, "template", "no LLM -> template mode");
  assert.equal(brief.facts.length, 1, "one fact from one event");
  assert.ok(brief.facts[0]!.text.tc.includes("180"), "the observed number is carried verbatim");
  assert.ok(brief.facts[0]!.text.tc.includes("120"), "the threshold is carried verbatim");
  assert.equal(brief.facts[0]!.ruleId, "ae_wait_long", "every fact traces to a rule id");
  assert.equal(brief.accumulating.length, 1, "the immature signal is disclosed");
  assert.equal(brief.accumulating[0]!.days, 5, "days accumulated is reported");

  // A fact must never carry causal wording either — the LLM is instructed not
  // to, but the TEMPLATE is what ships when it fails, so it must be clean too.
  const allText = [
    ...brief.facts.map((f) => f.text.tc + f.text.en),
    ...brief.convergences.map((c) => c.text.tc + c.text.en),
  ].join(" ");
  for (const causal of ["因為", "導致", "造成", "because", "caused", "due to"]) {
    assert.ok(!allText.includes(causal), `template carries no causal wording (${causal})`);
  }

  // The prompt's prohibitions are testable, so a future edit that drops one
  // fails here rather than silently loosening the LLM's brief.
  const prompt = N.narrativePrompt(brief.facts);
  for (const must of ["Do not infer causation", "Do not add context", "co-occurred", "Only restate"]) {
    assert.ok(prompt.includes(must), `prompt states: ${must}`);
  }
  assert.ok(prompt.includes("180"), "prompt carries the real numbers");

  const summary = N.briefSummary(brief, "tc");
  assert.ok(summary.includes("範本敘述"), `summary says template when there is no LLM: ${summary}`);
  assert.ok(summary.includes("累積中"), "summary discloses what is still accumulating");

  console.log(`\u2713 Tier 3/4：冇 LLM 都出到簡報（mode=${brief.mode}）· 數字原樣保留 · 累積中 ${brief.accumulating[0]!.days}/14 日`);
  console.log(`    範本：${brief.facts[0]!.text.tc}`);
  console.log(`    摘要：${summary}`);
}

// --- the orchestrator: null is not an observation of zero ---------------------
{
  // THE SUBTLE ONE. A missing reading (station closed, feed silent) must not be
  // folded as 0. Folding zeros drags the baseline mean down, and the next
  // ordinary reading then looks like a spike — a manufactured anomaly, produced
  // entirely by the act of measuring.
  const store = B.emptyStore();
  const withNull = A.updateBaselines(store, { ha_ae_waiting: { longestWaitMin: null } }, HK("2026-09-23T10:00:00+08:00"));
  assert.deepEqual(withNull, store, "a null reading folds nothing");

  const withAbsent = A.updateBaselines(store, { ha_ae_waiting: { hospitals: 3 } }, HK("2026-09-23T10:00:00+08:00"));
  assert.deepEqual(withAbsent, store, "an absent field folds nothing");

  const withValue = A.updateBaselines(store, { ha_ae_waiting: { longestWaitMin: 90 } }, HK("2026-09-23T10:00:00+08:00"));
  assert.equal(B.daysObserved(withValue, "ha_ae_waiting.longestWaitMin"), 1, "a real reading folds");
  // Derive the bucket key from the same helper the module uses, rather than
  // hardcoding "dow|hour" — a wrong literal here would silently pass by
  // asserting against the wrong bucket (it did, on the first run).
  const parts = B.hkParts(HK("2026-09-23T10:00:00+08:00"));
  const b = B.summarise(withValue.signals["ha_ae_waiting.longestWaitMin"]![B.bucketKey(parts.dow, parts.hour)]);
  assert.equal(b?.mean, 90, "the folded mean is the real reading, not 90 averaged with zeros");

  // End-to-end: analyse() produces a brief from live-shaped state, with no LLM
  // anywhere in the path.
  const rules: RuleDef[] = [
    { id: "ae", domain: "health", severity: 2, when: { source: "ha_ae_waiting", field: "longestWaitMin", op: ">=", value: 120 }, headline: { tc: "急症室輪候長", en: "A&E long" }, district_field: "district" },
    { id: "aq", domain: "environment", severity: 1, when: { source: "aqhi_city_dashboard", field: "maxAqhi", op: ">=", value: 7 }, headline: { tc: "空氣差", en: "AQHI high" }, district_field: "district" },
  ];
  const out = A.analyse({
    state: {
      ha_ae_waiting: { longestWaitMin: 200, district: "沙田區" },
      aqhi_city_dashboard: { maxAqhi: 9, district: "沙田區" },
    },
    rules,
    store: B.emptyStore(),
    now: HK("2026-09-23T10:00:00+08:00"),
    lang: "tc",
  });
  assert.equal(out.events.length, 2, "two rules fire");
  // Both are in 沙田區, so Tier 2 should converge them (2 domains).
  assert.equal(out.convergences.length, 1, "same district + 2 domains -> convergence");
  assert.equal(out.convergences[0]!.domains.length, 2, "two domains");
  // score = 2*3 + 2*2 + 2 = 12
  assert.equal(out.convergences[0]!.score, 12, `2 domains sev2 x2 events -> 12 (got ${out.convergences[0]!.score})`);
  assert.equal(out.brief.mode, "template", "no LLM in the runtime path");
  assert.equal(out.brief.convergences.length, 1, "the convergence reaches the brief");
  assert.ok(out.store.signals["ha_ae_waiting.longestWaitMin"], "baselines were updated by the run");

  console.log(`\u2713 編排：兩個規則觸發 → 同區 2 領域匯聚 score ${out.convergences[0]!.score} · mode=${out.brief.mode}`);
  console.log(`    缺值唔會當 0 折入基線（否則會製造假異常）`);
}

console.log("\nanalytics.test.ts: ALL PASS");
