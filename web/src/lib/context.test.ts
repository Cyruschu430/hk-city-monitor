// context.test.ts — PRIMITIVES §9 acceptance: assert-style, no framework.
// Run: node src/lib/context.test.ts

import assert from "node:assert/strict";
import {
  appliesTo,
  distanceKm,
  distanceToRouteKm,
  filterByScope,
  ROUTE_BUFFER_KM,
  type Context,
  type Locatable,
} from "./context.ts";

// 1. district scope filters correctly.
const items: Locatable[] = [
  { district: "深水埗", lat: 22.33, lon: 114.16 },
  { district: "南區", lat: 22.25, lon: 114.15 },
  { lat: 22.3, lon: 114.17 }, // no district field — shared territory-wide data
];
const ssp: Context = { scope: "district", district: "深水埗" };
const kept = filterByScope(items, ssp);
assert.equal(kept.length, 2, "only 深水埗 + the shared item survive");
assert.equal(kept[0]!.district, "深水埗");
assert.equal(kept[1]!.district, undefined, "source with no district field is NOT filtered out");
console.log("✓ district 過濾正確；冇 district 欄位嘅源唔會被濾走");

// 2. hk scope keeps everything, unchanged.
assert.equal(filterByScope(items, { scope: "hk" }).length, 3);
console.log("✓ hk scope 全保留");

// 3. route scope: a corridor along Nathan Road, 0.5 km buffer.
const nathan: [number, number][] = [
  [22.304, 114.171], // TST
  [22.33, 114.168], // Yau Ma Tei / Mong Kok
  [22.356, 114.126], // …toward Sham Shui Po (approx)
];
const routeCtx: Context = { scope: "route", route: nathan };
assert.equal(appliesTo({ lat: 22.32, lon: 114.169 }, routeCtx), true, "on the corridor");
assert.equal(appliesTo({ lat: 22.28, lon: 114.3 }, routeCtx), false, "Hung Hom Bay is far off");
assert.equal(appliesTo({ district: "南區" }, routeCtx), true, "no coordinates → shared, kept");
console.log(`✓ route scope corridor (buffer ${ROUTE_BUFFER_KM} km, constant)`);

// 4. distance sanity: HKO HQ → Central is ~2.2 km, not 22 and not 0.2.
const d = distanceKm(22.302, 114.174, 22.282, 114.158);
assert.ok(d > 1.5 && d < 3.5, `HKO→Central ≈ ${d.toFixed(2)} km`);
// a point 100 m off a segment measures ~0.1 km, not 1 km.
const off = distanceToRouteKm(22.3049, 114.171, [ [22.304, 114.171], [22.33, 114.168] ]);
assert.ok(off < 0.15, `100 m off-corridor measures ${off.toFixed(3)} km`);
console.log(`✓ 距離合理：HKO→中環 ${d.toFixed(2)} km；離線 100 m 量到 ${off.toFixed(3)} km`);

// 5. Purity: inputs not mutated.
const before = JSON.stringify(items);
filterByScope(items, ssp);
assert.equal(JSON.stringify(items), before);
console.log("✓ 純函數：唔改輸入");

console.log("\ncontext.test.ts: ALL PASS");
