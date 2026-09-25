// probe-click-path.mjs — does a click on the map even REACH the map?
//
// The station popup still did not open after wiring `map.on("click", layerId)`.
// Two very different causes look identical from the outside: (a) the click never
// reaches MapLibre because something is on top of the canvas, or (b) it reaches
// the map and the layer-scoped handler does not match. This splits them.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, locale: "zh-HK" });
page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 220)));
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log(`${m.type()}: ${m.text().slice(0, 200)}`);
});
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.evaluate(() => {
  [...document.querySelectorAll("#rail .rail-btn")]
    .find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("總覽"))?.click();
});
await page.waitForTimeout(2500);
await page.evaluate(() => {
  [...document.querySelectorAll("#rail .rail-btn")]
    .find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("氣象站"))?.click();
});
await page.waitForFunction(() => Boolean(window.__map?.getLayer("vl-weather_stations-point")), null, { timeout: 45_000 }).catch(() => {});
await page.waitForTimeout(2500);

// Instrument: record every click the map sees, and every layer-scoped hit.
await page.evaluate(() => {
  window.__clickLog = [];
  const m = window.__map;
  m.on("click", (e) => {
    const names = m.getStyle().layers.map((l) => l.id);
    const hits = m.queryRenderedFeatures(e.point);
    window.__clickLog.push({
      kind: "map",
      point: [Math.round(e.point.x), Math.round(e.point.y)],
      hitLayers: [...new Set(hits.map((f) => f.layer?.id))].slice(0, 8),
      totalStyleLayers: names.length,
    });
  });
  m.on("click", "vl-weather_stations-point", () => window.__clickLog.push({ kind: "stations-handler" }));
});

const target = await page.evaluate(() => {
  const m = window.__map;
  const feats = m.queryRenderedFeatures({ layers: ["vl-weather_stations-point"] });
  if (!feats.length) return { err: "no station rendered" };
  const p = m.project(feats[0].geometry.coordinates);
  return { x: Math.round(p.x), y: Math.round(p.y) };
});

const top = await page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  return el ? `${el.tagName}.${el.className || "(none)"}` : "none";
}, target);

console.log("target        :", JSON.stringify(target));
console.log("element on top:", top);

await page.mouse.click(target.x, target.y);
await page.waitForTimeout(1200);
console.log("click log     :", JSON.stringify(await page.evaluate(() => window.__clickLog), null, 1));
console.log("popups        :", await page.evaluate(() => document.querySelectorAll(".maplibregl-popup").length));

// Also try clicking a camera point, which has its own (working) click path.
const cam = await page.evaluate(() => {
  const m = window.__map;
  const f = m.queryRenderedFeatures({ layers: ["cameras-td-point", "cameras-td-cluster"] })[0];
  if (!f) return null;
  const p = m.project(f.geometry.coordinates);
  return { x: Math.round(p.x), y: Math.round(p.y), layer: f.layer.id };
});
console.log("camera target :", JSON.stringify(cam));
if (cam) {
  await page.mouse.click(cam.x, cam.y);
  await page.waitForTimeout(1200);
  console.log("after camera click — clicks:", (await page.evaluate(() => window.__clickLog.length)), "popups/drawer:",
    await page.evaluate(() => ({ popups: document.querySelectorAll(".maplibregl-popup").length, drawer: !!document.querySelector("#drawer.open, #drawer[data-open='true']") })));
}
await browser.close();
