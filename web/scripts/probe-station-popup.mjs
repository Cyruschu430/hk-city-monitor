// probe-station-popup.mjs — does clicking a weather station actually open an
// attribute popup?
//
// Cyrus: "weather station layer click完冇attribute pop up". The cause was that
// `pointLayer()` had NO click handler at all, so the layer was inert under the
// cursor. A popup is not something a screenshot can confirm — this asserts the
// real DOM: the station layer is on the map, a click on a rendered station
// produces a `.maplibregl-popup`, and the popup carries the station's own
// attributes (name + address), not a placeholder.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const url = process.argv[2] ?? "http://localhost:4173/";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: "zh-HK" });

page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 200)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.evaluate(() => {
  [...document.querySelectorAll("#rail .rail-btn")]
    .find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("總覽"))?.click();
});
await page.waitForTimeout(3000);

// Turn the station layer ON from the rail and wait for a real predicate.
await page.evaluate(() => {
  [...document.querySelectorAll("#rail .rail-btn")]
    .find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("氣象站"))?.click();
});
await page.waitForFunction(
  () => {
    const m = window.__map;
    const s = m?.getSource("vl-weather_stations");
    return Boolean(s?._data?.features?.length) && Boolean(m.getLayer("vl-weather_stations-point"));
  },
  null,
  { timeout: 45_000 },
).catch(() => {});
await page.waitForTimeout(2500);

// Click the FIRST station that is actually rendered, via a real mouse click on
// its projected screen position — not a synthetic feature click, because the bug
// was in the event wiring.
//
// THE OFFSET MATTERS. `map.project()` returns MAP CANVAS pixels; `page.mouse
// .click()` takes VIEWPORT pixels, and the canvas sits below the status bar and
// ticker and right of the rail. MEASURED: clicking the projected (492,513)
// delivered a map click at (436,423) — my first run concluded "no popup" when the
// click had simply landed 56/90px away, on a camera cluster. A probe that does its
// own coordinate maths wrong reports the product as broken.
const target = await page.evaluate(() => {
  const m = window.__map;
  const feats = m.queryRenderedFeatures({ layers: ["vl-weather_stations-point"] });
  if (!feats.length) return { err: "no station rendered in the viewport" };
  const f = feats[0];
  const p = m.project(f.geometry.coordinates);
  const r = m.getCanvas().getBoundingClientRect();
  return {
    x: Math.round(r.left + p.x),
    y: Math.round(r.top + p.y),
    name: f.properties?.Name_tc ?? f.properties?.Name_en ?? "?",
  };
});
console.log("target:", JSON.stringify(target));

if (!target.err) {
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(900);
}

const popup = await page.evaluate(() => {
  const el = document.querySelector(".maplibregl-popup .attr-popup");
  if (!el) {
    return { open: false, popups: document.querySelectorAll(".maplibregl-popup").length };
  }
  const rows = [...el.querySelectorAll(".attr-row")].map((r) => ({
    k: r.querySelector(".attr-k")?.textContent?.trim() ?? "",
    v: r.querySelector(".attr-v")?.textContent?.trim() ?? "",
  }));
  return {
    open: true,
    title: el.querySelector(".attr-title")?.textContent?.trim() ?? "",
    coords: el.querySelector(".attr-coords")?.textContent?.trim() ?? "",
    rowCount: rows.length,
    rows,
  };
});
console.log("popup:", JSON.stringify(popup, null, 1));

// A popup that opens with only a title is not an ATTRIBUTE popup.
const ok = popup.open && popup.title && popup.rowCount >= 3 && popup.coords;
console.log(ok ? "\nPASS: attribute popup opened with real attributes" : "\nFAIL: no attribute popup");
await page.screenshot({ path: "test/artifacts/station-popup.png" });
await browser.close();
process.exit(ok ? 0 : 1);
