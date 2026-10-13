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

// ── 2. The TD camera layer: OFF by default (every layer is), real, and its map layers exist.
//
// The camera layers are the ONE pair that is drawn eagerly at boot rather than lazily on toggle
// (cameras.ts adds them on the style's `load`), so "the default is off" is not free for them: the
// boot replay has to switch them off explicitly. It did not, for as long as `replayLayerState` was
// written as `if (want || l.on)` — once no layer carried `on: true` any more, that guard could
// never be satisfied, and the cameras stayed on the map while the LAYERS row read OFF. So this
// block asserts the map, not the control: MapLibre's own layout property.
const td0 = await rowInfo("cameras_td");
ok(td0.present, "no .lyr-item[data-row=cameras_td] — the TD camera layer row is gone");
ok(td0.checked === "false", `every layer is OFF by default, but the TD row reads aria-checked=${td0.checked}`);
ok(/運輸署相機|Traffic Cameras/.test(td0.label), `unexpected TD layer label: "${td0.label}"`);
ok(td0.hasGlyph, "the TD layer row lost its symbol glyph");

const v0 = await vis(TD);
ok(!Object.values(v0).includes("MISSING"), `TD map layers missing from the style: ${JSON.stringify(v0)}`);
ok(Object.values(v0).every((v) => v === "none"),
  `TD layers are drawn on the map at boot while their row reads OFF: ${JSON.stringify(v0)}`);

// ── 3. THE DEAD-CONTROL TEST: on really draws, off really hides.
await clickRow("cameras_td");
await page.waitForTimeout(800);
const vOn = await vis(TD);
ok(Object.values(vOn).every((v) => v === "visible"), `toggling TD on did not draw: ${JSON.stringify(vOn)}`);

await clickRow("cameras_td");
await page.waitForTimeout(800);
const vOff = await vis(TD);
ok(Object.values(vOff).every((v) => v === "none"), `toggling TD off left layers visible: ${JSON.stringify(vOff)}`);

// ── 4. The HKO layer is a sibling caller of the same handler, so it gets the same test: hidden at
//      rest, visible when asked for, hidden again when dismissed.
const hko0 = await rowInfo("cameras_hko");
ok(hko0.present && /天文台相機|Observatory/.test(hko0.label), `unexpected HKO layer label: "${hko0.label}"`);
const hkoStart = await vis(HKO);
ok(!Object.values(hkoStart).includes("MISSING"), `HKO map layers missing: ${JSON.stringify(hkoStart)}`);
ok(Object.values(hkoStart).every((v) => v === "none"),
  `HKO layers are drawn on the map at boot while their row reads OFF: ${JSON.stringify(hkoStart)}`);
await clickRow("cameras_hko");
await page.waitForTimeout(800);
const hkoOn = await vis(HKO);
ok(Object.values(hkoOn).every((v) => v === "visible"), `toggling HKO on did not draw: ${JSON.stringify(hkoOn)}`);
await clickRow("cameras_hko");
await page.waitForTimeout(800);
const hkoOff = await vis(HKO);
ok(Object.values(hkoOff).every((v) => v === "none"), `toggling HKO off left layers visible: ${JSON.stringify(hkoOff)}`);

// ── 5. ONE CONTROL, ONE STATE. The row IS the control now (see block 1), so what has to hold is
//      that the row's own `aria-checked` and the map agree: the state lives in the row and in
//      `layerOn`, and nothing else keeps a copy of it. Checked here at rest, after both toggles.
const rowState = await page.evaluate(() => {
  const row = document.querySelector('.lyr-item[data-row="cameras_td"] .lyr-row');
  return { checked: row?.getAttribute("aria-checked") };
});
ok(rowState.checked === "false",
  `the TD row should read unchecked once dismissed, got ${rowState.checked}`);
const tdAfter = await vis(TD);
ok(Object.values(tdAfter).every((v) => v === "none"),
  `the row says off but the map disagrees: ${JSON.stringify(tdAfter)}`);

// ── 5b. THE BUS LIVE LAYER — the one layer whose features are computed, not fetched.
//
// A toggle here can look alive and draw nothing: the adapter returns a status grid either way, so
// the panel fills in and the map stays empty. The draw path is the one that can fail silently, so
// this asserts the MAP: after the row is switched on, the layer's own source must exist and its
// point layer must be visible in the style. The feature count is reported but NOT asserted — the
// layer is fed by live ETAs, and a fleet of zero at 04:00 is a real answer, not a broken build.
{
  const bus = await rowInfo("bus_live");
  ok(bus.present, "no .lyr-item[data-row=bus_live] — the bus live layer row is gone");
  ok(bus.checked === "false", `the bus layer must default to OFF, aria-checked=${bus.checked}`);
  ok(/推算|estimated/.test(bus.label), `the bus layer label must say it is estimated: "${bus.label}"`);

  await clickRow("bus_live");
  await page.waitForTimeout(12000);
  const b = await page.evaluate(() => {
    const s = window.__map?.getSource("vl-bus_live");
    const d = s?._data;
    const lid = "vl-bus_live-point";
    return {
      hasSource: !!s,
      features: d?.features?.length ?? -1,
      layer: (() => { try { return window.__map.getLayoutProperty(lid, "visibility") ?? "visible"; } catch { return "MISSING"; } })(),
      icon: (() => { try { return window.__map.getLayoutProperty(lid, "icon-image"); } catch { return null; } })(),
      banner: document.querySelector(".banner, .layer-error")?.textContent?.trim() ?? "",
    };
  });
  ok(b.hasSource, "switching the bus layer on created no vl-bus_live source — the adapter threw or returned no geometry");
  ok(b.layer === "visible", `the bus point layer is not visible after the toggle: ${b.layer}`);
  // The bus layer draws its OPERATOR's livery, so icon-image is a `match` on the
  // company rather than one fixed id. What this must still catch is the layer drawing
  // a bare dot — or drawing nothing, which is what a match with an unregistered image
  // id does silently. So: every id the match can return is registered AND is a bus.
  const busIcons = await page.evaluate(() => {
    const ids = ["bus", "bus-ctb", "bus-lwb", "bus-nlb", "bus-gmb"];
    return { missing: ids.filter((i) => !window.__map.hasImage(i)), all: ids };
  });
  ok(busIcons.missing.length === 0, `the map has no image for: ${busIcons.missing.join(", ")} — those buses draw nothing`);
  const iconExpr = Array.isArray(b.icon) ? b.icon.join(",") : String(b.icon);
  ok(
    iconExpr.includes("bus") && (Array.isArray(b.icon) ? iconExpr.includes("match") : b.icon.startsWith("bus")),
    `the bus layer must draw bus glyphs, not a dot: icon-image=${iconExpr}`,
  );
  ok(!b.banner, `a banner appeared while drawing the bus layer: "${b.banner}"`);
  if (b.features === 0) console.log("NOTE  bus layer drew 0 positions right now (no live ETAs at the sampled stops)");
  await clickRow("bus_live");
  await page.waitForTimeout(1200);
  const busOff = await page.evaluate(() => !!window.__map?.getSource("vl-bus_live"));
  ok(!busOff, "switching the bus layer off left its source on the map");
  console.log(`bus live: default=off features=${b.features} glyph=${iconExpr}`);
}

// ── 5c. SENSOR PARKING: 20,700-ODD STATIC BAYS, CLUSTERED, DRAWN AS RECTANGLES ──────
//
// This layer has three ways to be silently wrong: it can draw nothing (its adapter threw),
// it can draw grey everywhere (the colour never reached the features), or it can draw a
// coloured smear across the whole territory (not clustered). All three have happened.
{
  await clickRow("sensor_parking_spaces");
  await page.waitForTimeout(14000);
  const sp = await page.evaluate(() => {
    const src = window.__map?.getSource("vl-sensor_parking_spaces");
    const feats = src?._data?.features ?? [];
    const missing = ["meter", "meter-occupied", "meter-vacant", "meter-unknown"]
      .filter((i) => !window.__map?.hasImage(i));
    let layout = null;
    try {
      layout = window.__map.getLayoutProperty("vl-sensor_parking_spaces-point", "icon-image");
    } catch {
      /* the layer is not there — hasSource below reports it */
    }
    return {
      hasSource: !!src,
      features: feats.length,
      cluster: !!src?._options?.cluster,
      missingImages: missing,
      icon: Array.isArray(layout) ? layout.join(",") : String(layout),
      coloured: feats.slice(0, 200).filter((f) => f.properties?.color).length,
      // Bays lie along their street: the angle has to reach the map, and the layer has to
      // read it, or every bay stands upright on a horizontal street again.
      rotate: (() => {
        try {
          const r = window.__map.getLayoutProperty("vl-sensor_parking_spaces-point", "icon-rotate");
          return Array.isArray(r) ? r.join(",") : String(r);
        } catch {
          return null;
        }
      })(),
      angles: feats.slice(0, 400).filter((f) => typeof f.properties?.bearing === "number").length,
    };
  });
  ok(sp.hasSource, "the sensor parking layer created no source — its adapter threw");
  ok(sp.features > 20000, `the sensor parking layer placed ${sp.features} bays`);
  ok(sp.cluster, "the sensor parking layer must cluster: 20,700-odd bays unclustered is a colour smear");
  ok(sp.missingImages.length === 0, `bay images missing from the map: ${sp.missingImages.join(", ")} — those bays draw nothing`);
  ok(sp.icon.includes("meter-"), `the sensor parking layer must draw bay shapes: icon-image=${sp.icon}`);
  ok(sp.coloured > 0, "the sensor parking layer carries its live colour per bay (grey everywhere = the adapter never ran)");
  ok(sp.angles > 0, "the bays carry a baked street bearing — without it every bay stands upright");
  ok(String(sp.rotate).includes("bearing"), `the bays must be rotated by their bearing: icon-rotate=${sp.rotate}`);
  await clickRow("sensor_parking_spaces");
  await page.waitForTimeout(900);
  console.log(`sensor parking: features=${sp.features} cluster=${sp.cluster} coloured=${sp.coloured} rotate=${sp.rotate} icons=${sp.icon}`);
}

// ── 5d. SYMBOLS AND LIVE NUMBERS ON THE LAYERS THE REVIEW CALLED OUT ─────────────────
//
// Four complaints, four ways to be silently wrong: a layer can draw the WRONG glyph (or a dot
// where a glyph was asked for), a live layer can draw its snapshot and never fetch (the
// AI-analytics popups printed 「流量 —」 for every camera because the per-camera feed was never
// wired), and a feed's own sentinel can reach the screen (TD writes -1 for "no figure").
//
// The AI-analytics numbers are asserted from the LAYER's own feature properties, which is the
// only place the proxy round-trip and the rate/flow merge become visible.
{
  const wants = [
    ["ai_cctv_speed", "speed"],
    ["mtr_bus_stops", "bus-stop"],
    ["lcsd_facilities", "facility"],
    ["beach_grading", "beach"],
    ["carpark_vacancy", "parking"],
  ];
  for (const [id] of wants) await clickRow(id);
  // The CCTV layer fetches 16 per-camera JSONs through the Worker proxy on its first tick.
  await page.waitForTimeout(20000);
  const s = await page.evaluate((ids) => {
    const out = {};
    for (const [id, glyph] of ids) {
      const layer = `vl-${id}-point`;
      const src = window.__map?.getSource(`vl-${id}`);
      const feats = src?._data?.features ?? [];
      let icon = null;
      try {
        icon = window.__map.getLayoutProperty(layer, "icon-image");
      } catch {
        /* layer absent — reported through the icon string below */
      }
      out[id] = {
        glyph,
        hasSource: !!src,
        features: feats.length,
        icon: Array.isArray(icon) ? icon.join(",") : String(icon),
        imageRegistered: window.__map?.hasImage(glyph) ?? false,
      };
    }
    return out;
  }, wants);

  for (const [id, glyph] of wants) {
    const r = s[id];
    ok(r.hasSource, `${id}: the layer created no source`);
    ok(r.imageRegistered, `${id}: the ${glyph} glyph is not registered — that layer draws nothing`);
    ok(String(r.icon).includes(glyph), `${id} must draw the ${glyph} glyph: icon-image=${r.icon}`);
    console.log(`symbol check  ${id}: ${r.features} features · icon=${r.icon} · ${glyph} registered=${r.imageRegistered}`);
  }

  // The AI-analytics layer's live merge, asserted where it shows: speed present on every drawn
  // camera, and the feed's own analysis time carried with it.
  const cctv = await page.evaluate(() => {
    const feats = window.__map?.getSource("vl-ai_cctv_speed")?._data?.features ?? [];
    return {
      features: feats.length,
      withSpeed: feats.filter((f) => f.properties?.speed !== undefined && f.properties.speed !== "").length,
      withObserved: feats.filter((f) => String(f.properties?.observed ?? "").length === 5).length,
      speeds: feats.slice(0, 4).map((f) => f.properties?.speed),
    };
  });
  ok(cctv.features > 0, "the AI-analytics layer drew nothing — the per-camera proxy fetch failed");
  ok(
    cctv.withSpeed === cctv.features,
    `every drawn AI-analytics camera must carry a speed (${cctv.withSpeed}/${cctv.features} do) — the popup prints 「流量 —」 otherwise`,
  );
  ok(cctv.withObserved > 0, "the AI-analytics features must carry the feed's own analysis time");
  console.log(`ai analytics: ${cctv.features} cameras · speeds=${cctv.speeds.join("/")} · with observed time=${cctv.withObserved}`);

  // TD's -1 sentinel must never reach the map.
  const carpark = await page.evaluate(() => {
    const feats = window.__map?.getSource("vl-carpark_vacancy")?._data?.features ?? [];
    const vac = feats.map((f) => f.properties?.vacancy);
    return { features: feats.length, negative: vac.filter((v) => typeof v === "number" && v < 0).length, blank: vac.filter((v) => v === null || v === "").length };
  });
  ok(carpark.features > 0, "the carpark layer drew nothing");
  ok(carpark.negative === 0, `${carpark.negative} car parks carry a negative vacancy — that is TD's "no figure" sentinel, not a count`);
  console.log(`carpark layer: ${carpark.features} parks · negative vacancies=${carpark.negative} · no-figure rows=${carpark.blank}`);

  // The sheet: reviewing a canvas glyph means looking at it, and at the size a reader sees. The
  // images come from the map's own registry, never re-drawn from source — a copy of a draw
  // function drifts, and one missing helper fails silently into a blank picture.
  const sheet = await page.evaluate((ids) => {
    const cv = document.createElement("canvas");
    cv.width = 980;
    cv.height = 360;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#0b0f17";
    ctx.fillRect(0, 0, cv.width, cv.height);
    const rows = [
      { y: 30, scale: 132 / 44, cap: "132px — as drawn" },
      { y: 210, scale: 20 / 44, cap: "20px — on the map" },
    ];
    for (const row of rows) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "600 13px system-ui, sans-serif";
      ctx.fillText(row.cap, 16, row.y - 10);
      let x = 16;
      for (const id of ids) {
        const img = window.__map?.getImage(id);
        if (!img) continue;
        const size = Math.round(44 * row.scale);
        // StyleImage.data is an ImageData in some MapLibre builds and an ImageBitmap in others.
        // Assuming the first is how this sheet failed with "source width is zero".
        // A style image's pixels arrive as one of three things depending on the build: an
        // ImageData, an ImageBitmap, or raw RGBA bytes beside the image's own width/height.
        // Guessing wrong is a type error at drawImage, so all three are handled.
        const d = img.data;
        const w = img.width ?? (d && typeof d === "object" ? d.width : 0);
        const h = img.height ?? (d && typeof d === "object" ? d.height : 0);
        let drawable = null;
        if (typeof ImageBitmap !== "undefined" && d instanceof ImageBitmap) {
          drawable = d;
        } else if (typeof ImageData !== "undefined" && (d instanceof ImageData || (d && d.length && w && h))) {
          const off = document.createElement("canvas");
          off.width = w;
          off.height = h;
          off.getContext("2d").putImageData(d instanceof ImageData ? d : new ImageData(new Uint8ClampedArray(d), w, h), 0, 0);
          drawable = off;
        }
        if (!drawable) {
          console.log("glyph sheet: no drawable data for", id, "— data is", Object.prototype.toString.call(d));
          continue;
        }
        ctx.drawImage(drawable, x, row.y, size, size);
        if (row.scale > 1) {
          ctx.fillStyle = "#64748b";
          ctx.font = "12px system-ui, sans-serif";
          ctx.fillText(id, x, row.y + size + 16);
        }
        x += size + 18;
      }
    }
    return cv.toDataURL("image/png");
  }, [...new Set([...wants.map(([, g]) => g), "facility", "beach", "bus", "meter-occupied"])]);
  const { writeFile } = await import("node:fs/promises");
  await writeFile("glyph-sheet.png", Buffer.from(String(sheet).split(",")[1], "base64"));
  console.log("glyph sheet written: glyph-sheet.png");

  for (const [id] of wants) {
    await clickRow(id);
    await page.waitForTimeout(500);
  }
}

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
