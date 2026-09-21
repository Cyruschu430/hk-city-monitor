// trigger.test.ts — PRIMITIVES §9 acceptance: assert-style, no framework.
// Run: node src/lib/trigger.test.ts  (Node ≥23.6 strips types natively)

import assert from "node:assert/strict";
import { activeVertical, getPath, type State, type VerticalDef } from "./trigger.ts";

const verticals: VerticalDef[] = [
  {
    id: "typhoon",
    trigger: {
      any: [
        { source: "hko_warnsum", field: "TC8", op: "exists" },
        { source: "hko_warnsum", field: "TC3", op: "exists" },
      ],
    },
  },
  {
    id: "water_supply",
    trigger: { any: [{ source: "wsd_water_suspension", field: "records", op: "exists" }] },
  },
  { id: "leave", trigger: null },
];

// 1. T8 hoisted → typhoon mode activates.
const t8: State = { hko_warnsum: { TC8: { name: "八號烈風或暴風信號" } } };
assert.equal(activeVertical(t8, verticals), "typhoon", "T8 must activate typhoon mode");
console.log("✓ T8 觸發颱風模式:", activeVertical(t8, verticals));

// 1b. T3 also triggers it (warnsum keys exist while the signal is up).
assert.equal(activeVertical({ hko_warnsum: { TC3: { name: "三號強風信號" } } }, verticals), "typhoon");
console.log("✓ T3 觸發颱風模式");

// 2. No warnings → null. warnsum returns {} when nothing is in force — that
//    is the normal quiet state and must NOT fire anything.
assert.equal(activeVertical({ hko_warnsum: {} }, verticals), null);
assert.equal(activeVertical({}, verticals), null);
assert.equal(activeVertical({ wsd_water_suspension: { records: [] } }, verticals), null);
console.log("✓ 無警告／空記錄 → null");

// 2b. Live water-suspension records → water mode.
const wsd: State = { wsd_water_suspension: { records: [{ district: "深水埗" }] } };
assert.equal(activeVertical(wsd, verticals), "water_supply");
console.log("✓ 停水記錄觸發停水模式");

// 3. Purity: same input twice → same result, and the input is not mutated.
const before = JSON.stringify(t8);
assert.equal(activeVertical(t8, verticals), activeVertical(t8, verticals));
assert.equal(JSON.stringify(t8), before, "state must not be mutated");
console.log("✓ 純函數：同輸入同輸出，唔改輸入");

// 4. Priority: higher priority wins; tie → verticals.json order.
const prio: VerticalDef[] = [
  { id: "a", priority: 1, trigger: { any: [{ source: "s", field: "x", op: "exists" }] } },
  { id: "b", priority: 5, trigger: { any: [{ source: "s", field: "x", op: "exists" }] } },
];
assert.equal(activeVertical({ s: { x: 1 } }, prio), "b");
const tie: VerticalDef[] = [
  { id: "first", trigger: { any: [{ source: "s", field: "x", op: "exists" }] } },
  { id: "second", trigger: { any: [{ source: "s", field: "x", op: "exists" }] } },
];
assert.equal(activeVertical({ s: { x: 1 } }, tie), "first", "tie → array order");
console.log("✓ priority 高者勝；同分按 verticals.json 次序");

// 5. Operators: the closed set, all four comparison forms.
const ops: VerticalDef[] = [
  { id: "ge", trigger: { any: [{ source: "aqhi", field: "level", op: ">=", value: 8 }] } },
  { id: "le", trigger: { any: [{ source: "aqhi", field: "level", op: "<=", value: 3 }] } },
  { id: "eq", trigger: { any: [{ source: "m", field: "state", op: "==", value: "closed" }] } },
  { id: "in", trigger: { any: [{ source: "m", field: "state", op: "in", value: ["closed", "limited"] }] } },
];
assert.equal(activeVertical({ aqhi: { level: 9 } }, ops), "ge");
assert.equal(activeVertical({ aqhi: { level: 2 } }, ops), "le");
// "closed" matches BOTH "eq" and "in" → tie → first in verticals.json order.
assert.equal(activeVertical({ m: { state: "closed" } }, ops), "eq", "tie → first in order");
// "limited" matches only "in".
assert.equal(activeVertical({ m: { state: "limited" } }, ops), "in");
assert.equal(activeVertical({ m: { state: "open" }, aqhi: { level: 5 } }, ops), null);
console.log("✓ operators >= <= == in 全部啱用");

// 6. getPath: dotted paths into nested payloads.
assert.equal(getPath({ a: { b: [{ c: 7 }] } }, "a.b.0.c"), 7);
assert.equal(getPath({ a: 1 }, "a.b.c"), undefined);
assert.equal(getPath(null, "a"), undefined);
console.log("✓ getPath 巢狀路徑");

console.log("\ntrigger.test.ts: ALL PASS");
