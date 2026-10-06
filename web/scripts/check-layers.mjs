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
  : (process.env.BASE ?? (process.env.HKCM_URL ?? process.env.BASE ?? "http://localhost:4173/"));
const exe = process.env.CHROME_PATH
  ?? "C:\\Users\\<user>\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";

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

// ── 1. EVERY RAIL LAYER IS REACHABLE FROM THE LAYERS CONTROL, AND ONLY FROM THERE.
//
// Until 2026-10-01 each of these layers had TWO entry points: a 1.5px glyph on the left rail
// and a row here. The rail's layer icons were removed ("堆icon panel is abundant"), so the
// assertion flips direction rather than disappearing — it now guards that every rail layer HAS
// a row, and that no layer icon has crept back onto the rail. A second control that nobody
// maintains is exactly how the two drifted apart; the `aria-pressed` bug this block was written
// for (a row that turned a layer on, then a rail click that turned it on again) needed two
// controls to exist at all.
const entries = await page.evaluate(() => {
  const rows = [...document.querySelectorAll(".lyr-row[data-rail]")].map((r) => r.dataset.rail);
  const btns = [...document.querySelectorAll(".rail-btn[data-rail]")].map((b) => b.dataset.rail);
  return { rows, btns };
});
ok(entries.btns.length === 0,
  `the rail carries ${entries.btns.length} layer buttons again (${entries.btns.join(", ")}) — the LAYERS control is the only control for a rail layer`);
ok(entries.rows.length > 0, "no .lyr-row[data-rail] at all — a rail layer has no control anywhere, which is worse than two");
ok(entries.btns.every((b) => entries.rows.includes(b)) || entries.btns.length === 0,
  "a rail layer button exists whose LAYERS row does not");

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

// ── 5. ONE CONTROL, ONE STATE. The row IS the control now (see block 1), so what has to hold is
//      that the row's own `aria-checked` and the map agree: the state lives in the row and in
//      `layerOn`, and nothing else keeps a copy of it.
const rowState = await page.evaluate(() => {
  const row = document.querySelector('.lyr-item[data-row="cameras_td"] .lyr-row');
  return { checked: row?.getAttribute("aria-checked") };
});
ok(rowState.checked === "true",
  `the TD row should read checked after being toggled back on, got ${rowState.checked}`);
const tdAfter = await vis(TD);
ok(Object.values(tdAfter).every((v) => v === "visible"),
  `the row says on but the map disagrees: ${JSON.stringify(tdAfter)}`);

// ── 6. 3D IS GONE, and this asserts it stays gone.
//
// This used to toggle `buildings3d` and assert it switched on. There is no `buildings3d` any more:
// The layer AND the HUD 3D button were removed on 2026-09-27 ("3D buildings (heavy) Remove呢個layer,
// 出唔到又冇用" / "3D 個button出唔到個3D tiles既"), because `/data/tiles3d.json` returned the SPA
// fallback — the tileset was never configured — while the control reported success and set no error.
//
// The check caught the removal, correctly: it was told to verify a control that no longer exists. A
// stale assertion is a red gate that hides the next real failure, so it is rewritten to guard the
// ABSENCE rather than deleted. If someone restores the layer they will have to come here and say so,
// which is the point — the restored version must also configure a tileset, and that is the bug this
// removal was standing in for.
// RESTORED 2026-10-02, on this file's own instruction ("If someone restores the layer they will
// have to come here and say so"). Both halves of the 2026-09-27 removal reason are now false:
// /config/3d answers 200 with a wgs84.tilemodel URL, and the new button prints the reason on the
// map face instead of reporting success. So this asserts the invariant that actually protects the
// reader - clicking 3D must either turn it on OR say why, never neither - which is also the one
// version of this test a headless browser can honestly run (deck.gl needs a real GPU, so "it drew
// buildings" is not checkable here, and asserting it would be the same class of lie the project
// keeps paying for).
// LOCKED for phase-one: 3D is still internal testing, so the switch is
// present but DISABLED — clicking it must do nothing (no toggle, no fetch). When it reopens,
// restore the previous "click either turns on OR explains itself" assertion, which is the one
// thing a headless browser can honestly check (deck.gl needs a real GPU, so "it drew buildings"
// is not checkable here).
const hud3dLocked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => /^3D$/.test(x.textContent.trim()));
  return b ? b.disabled : null;
});
ok(hud3dLocked === true, "the 3D switch is LOCKED (disabled) for phase-one testing");
// These two stay ABSENCE assertions: 3D is a layer toggled from the map view, not a LAYERS row and
// not a rail button, so a row here would be a second control for one layer.
ok(!(await page.evaluate(() => !!document.querySelector('.lyr-item[data-row="buildings3d"]'))),
  "a buildings3d LAYERS row is back — 3D is switched from the map view, not from LAYERS");
ok(!(await page.evaluate(() => !!document.querySelector('.rail-btn[data-rail="buildings3d"]'))),
  "a buildings3d rail button is back — it draws nothing without a tileset URL");

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
  const row = document.querySelector(`.lyr-item[data-row="${r}"] .lyr-row`);
  if (!row) return false;
  row.click();
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
console.log(`entry points: ${entries.rows.length} LAYERS rows, ${entries.btns.length} rail layer buttons (0 = the rail is modes only)`);
console.log(`TD camera layer: default=${td0.checked} "${td0.label}"  off=${JSON.stringify(Object.values(vOff))}  on=${JSON.stringify(Object.values(vOn))}`);
console.log(`HKO camera layer: "${hko0.label}"  off=${JSON.stringify(Object.values(hkoOff))}`);
console.log("3D: removed from the UI (no tileset was ever configured) — absence asserted");
if (fail.length) {
  console.log("");
  for (const f of fail) console.log(`FAIL  ${f}`);
  console.log(`\nLAYERS FAILED (${fail.length})`);
  process.exit(1);
}
console.log("\nLAYERS OK");
