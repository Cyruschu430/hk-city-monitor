// check-layers.mjs — the map layer controls: do they change the MAP, and does every control that
// claims to drive a layer actually reach one.
//
// WHAT THIS EXISTS FOR. A toggle that flips its own state and changes nothing on the map is a dead
// control that looks alive, and it is the hardest kind to notice because the thing the user touched
// DID respond. So every assertion here reads MapLibre's own layout property, never the control's
// `aria-checked` — the control agreeing with itself proves nothing.
//
// The second class is addressability: a layer has TWO entry points (the rail icon and the LAYERS
// row), and each drives the other. If one of them is missing from the DOM, a control exists that
// goes nowhere — and nothing in the build notices, because both are created from the same list.
//
// NOT CHECKED, and deliberately: whether a toggle reports PROGRESS. It was written, measured, and
// deleted. Measured with a 40ms poll: `buildings3d` toggles in 116ms, `weather_stations` 212ms,
// `wind_field` 1216ms, and the four visibility-only layers are instantaneous. `await toggle3d` does
// NOT await the tileset — it builds the deck.gl layer and returns, and the tiles then stream in
// visibly over ~19s, which IS the feedback. A busy state with a 250ms visual delay would have served
// exactly one layer by 1.2s. Not worth a state machine.
//
// Usage: node scripts/check-layers.mjs [baseUrl]

import { chromium } from "playwright-core";

const firstArg = process.argv[2];
const BASE = (firstArg && !firstArg.startsWith("--"))
  ? firstArg
  : (process.env.BASE ?? "http://127.0.0.1:4173/");
const exe = process.env.CHROME_PATH
  ?? "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });

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
await page.waitForTimeout(9000);

const fail = [];
const ok = (cond, why) => { if (!cond) fail.push(why); };

/** MapLibre's own answer for a layer id — never the control's. */
const vis = (ids) => page.evaluate((ls) => Object.fromEntries(
  ls.map((l) => [l, (() => {
    try { return window.__map.getLayoutProperty(l, "visibility") ?? "visible"; } catch { return "MISSING"; }
  })()]),
), ids);

const TD = ["cameras-td-cluster", "cameras-td-count", "cameras-td-point"];
const HKO = ["cameras-hko-cluster", "cameras-hko-count", "cameras-hko-point"];

const rowInfo = (id) => page.evaluate((r) => {
  const item = document.querySelector(`.lyr-item[data-row="${r}"]`);
  const sw = item?.querySelector(".lyr-row");
  return {
    present: !!item,
    checked: sw?.getAttribute("aria-checked") ?? null,
    label: item?.querySelector(".lyr-label")?.textContent?.trim() ?? "",
    hasGlyph: !!sw?.querySelector(".lyr-glyph"),
    rail: sw?.dataset.rail ?? null,
  };
}, id);

const clickRow = (id) => page.evaluate((r) => {
  const el = document.querySelector(`.lyr-item[data-row="${r}"] .lyr-row`);
  if (!el) return false;
  el.click();
  return true;
}, id);

// ── 1. Every LAYERS row that claims a rail link has a rail button to link to.
const entries = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".lyr-row[data-rail]")].map((r) => r.dataset.rail);
  const btns = [...document.querySelectorAll(".rail-btn[data-rail]")].map((b) => b.dataset.rail);
  return { rows, btns, orphanRows: rows.filter((r) => !btns.includes(r)) };
});
ok(entries.btns.length > 0, "no .rail-btn[data-rail] at all — the rail's layer buttons are not addressable, so nothing can verify them");
ok(entries.orphanRows.length === 0, `LAYERS rows drive rail buttons that do not exist: ${entries.orphanRows.join(", ")}`);

// ── 2. The TD camera layer: on by default, real, and its map layers exist.
const td0 = await rowInfo("cameras_td");
ok(td0.present, "no .lyr-item[data-row=cameras_td] — the TD camera layer row is gone");
ok(td0.checked === "true", `the TD camera layer should default to on, aria-checked=${td0.checked}`);
ok(/運輸署相機|Traffic Cameras/.test(td0.label), `unexpected TD layer label: "${td0.label}"`);
ok(td0.hasGlyph, "the TD layer row lost its symbol glyph");

const v0 = await vis(TD);
ok(!Object.values(v0).includes("MISSING"), `TD map layers missing from the style: ${JSON.stringify(v0)}`);
ok(Object.values(v0).every((v) => v === "visible"), `TD layers should start visible, got ${JSON.stringify(v0)}`);

// ── 3. THE DEAD-CONTROL TEST: off really hides, on really restores.
await clickRow("cameras_td");
await page.waitForTimeout(800);
const vOff = await vis(TD);
ok(Object.values(vOff).every((v) => v === "none"), `toggling TD off left layers visible: ${JSON.stringify(vOff)}`);

await clickRow("cameras_td");
await page.waitForTimeout(800);
const vOn = await vis(TD);
ok(Object.values(vOn).every((v) => v === "visible"), `toggling TD back on did not restore: ${JSON.stringify(vOn)}`);

// ── 4. The HKO layer is a sibling caller of the same handler, so it gets the same test.
const hko0 = await rowInfo("cameras_hko");
ok(hko0.present && /天文台相機|Observatory/.test(hko0.label), `unexpected HKO layer label: "${hko0.label}"`);
const hkoStart = await vis(HKO);
ok(!Object.values(hkoStart).includes("MISSING"), `HKO map layers missing: ${JSON.stringify(hkoStart)}`);
await clickRow("cameras_hko");
await page.waitForTimeout(800);
const hkoOff = await vis(HKO);
ok(Object.values(hkoOff).every((v) => v === "none"), `toggling HKO off left layers visible: ${JSON.stringify(hkoOff)}`);
await clickRow("cameras_hko");
await page.waitForTimeout(800);

// ── 5. The rail button IS the single implementation of "on": the row drives it, so clicking the
//      row must flip the BUTTON, not just the row. This is the bug that made the row turn a layer
//      ON and then the next rail click turn it on again.
const railSync = await page.evaluate(() => {
  const btn = document.querySelector('.rail-btn[data-rail="cameras_td"]');
  const row = document.querySelector('.lyr-item[data-row="cameras_td"] .lyr-row');
  return { btnPressed: btn?.getAttribute("aria-pressed"), rowChecked: row?.getAttribute("aria-checked") };
});
ok(railSync.btnPressed !== null, "no .rail-btn[data-rail=cameras_td] — the rail button is unreachable");
ok(railSync.btnPressed === railSync.rowChecked,
  `the row and the rail disagree about TD being on: row=${railSync.rowChecked} rail=${railSync.btnPressed}`);

// ── 6. The 3D toggle resolves and flips its own state (it does NOT wait for the tileset — see the
//      header note). A blocking-forever toggle, or one that silently no-ops, is what this rules out.
const t3d = Date.now();
await clickRow("buildings3d");
await page.waitForTimeout(1200);
const d3 = await rowInfo("buildings3d");
const ms = Date.now() - t3d;
ok(d3.present, "no .lyr-item[data-row=buildings3d] — the 3D layer row is gone");
ok(d3.checked === "true", `clicking the 3D row did not switch it on, aria-checked=${d3.checked}`);
ok(ms < 8000, `the 3D toggle took ${ms}ms to settle — it must not block on the tileset`);
await clickRow("buildings3d");
await page.waitForTimeout(1200);

// ── 7. THE DRONE RFZ LAYER — the first polygon layer since the water tint was removed, and the
//      only layer here that must NOT load until it is asked for. 290 polygons is 3MB: more than the
//      entire first paint of this app. Two things therefore have to hold, and a screenshot of a
//      settled map proves neither: the file is absent from the network until the toggle is pressed,
//      and once pressed the source really carries the features rather than an empty collection.
const rfz = await rowInfo("drone_rfz");
ok(rfz.present, "no .lyr-item[data-row=drone_rfz] — the drone RFZ layer row is gone");
ok(rfz.checked === "false", `the RFZ layer must default to OFF (3MB), aria-checked=${rfz.checked}`);
ok(/無人機禁飛區|Drone restricted/.test(rfz.label), `unexpected RFZ label: "${rfz.label}"`);

const loadedBefore = await page.evaluate(() =>
  performance.getEntriesByType("resource").some((e) => e.name.includes("drone_restricted_zone")));
ok(!loadedBefore, "the 3MB GeoJSON was fetched BEFORE the toggle was pressed — it is not lazy");

const toggleRfz = (id) => page.evaluate((r) => {
  const btn = document.querySelector(`.rail-btn[data-rail="${r}"]`);
  if (!btn) return false;
  btn.click();
  return true;
}, id);
const rfzFeat = () => page.evaluate(() => {
  const s = window.__map?.getSource("vl-drone_rfz");
  const d = s?._data;
  const layers = ["vl-drone_rfz-fill", "vl-drone_rfz-line"];
  return {
    hasSource: !!s,
    features: d?.features?.length ?? -1,
    layers: layers.map((l) => [l, (() => { try { return window.__map.getLayoutProperty(l, "visibility") ?? "visible"; } catch { return "MISSING"; } })()]),
    rendered: (() => { try { return window.__map.queryRenderedFeatures({ layers: ["vl-drone_rfz-fill"] }).length; } catch { return -1; } })(),
  };
});

await toggleRfz("drone_rfz");
await page.waitForTimeout(4000);
const r0 = await rfzFeat();
ok(r0.hasSource, "toggling the RFZ layer on did not create the vl-drone_rfz source");
ok(r0.features === 290, `the source should carry all 290 zones, got ${r0.features}`);
ok(!r0.layers.some(([, v]) => v === "MISSING"), `RFZ layer(s) missing from the style: ${JSON.stringify(r0.layers)}`);
ok(r0.rendered > 0, "the RFZ fill layer is in the style but renders 0 features at the default view — a toggle that draws nothing reads as broken");

await toggleRfz("drone_rfz");
await page.waitForTimeout(1200);
const r1 = await page.evaluate(() => !!window.__map?.getSource("vl-drone_rfz"));
ok(!r1, "toggling the RFZ layer off left its source on the map — the toggle only adds");

await browser.close();
console.log(`drone RFZ: lazy=${!loadedBefore} default=${rfz.checked} features=${r0.features} rendered=${r0.rendered} removed=${!r1}`);
console.log(`entry points: ${entries.btns.length} rail buttons, ${entries.rows.length} rows, 0 orphaned`);
console.log(`TD camera layer: default=${td0.checked} "${td0.label}"  off=${JSON.stringify(Object.values(vOff))}  on=${JSON.stringify(Object.values(vOn))}`);
console.log(`HKO camera layer: "${hko0.label}"  off=${JSON.stringify(Object.values(hkoOff))}`);
console.log(`3D toggle settled in ${ms}ms`);
if (fail.length) {
  console.log("");
  for (const f of fail) console.log(`FAIL  ${f}`);
  console.log(`\nLAYERS FAILED (${fail.length})`);
  process.exit(1);
}
console.log("\nLAYERS OK");
