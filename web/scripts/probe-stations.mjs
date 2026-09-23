// probe-stations.mjs — does the CSDI station layer draw?
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 180)); });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(11_000);

const panel = await page.evaluate(() => {
  const p = document.querySelector('.panel[data-panel="stations_status"]');
  return p ? { state: p.dataset.state, text: p.querySelector(".panel-body")?.textContent?.trim() } : null;
});
console.log("panel:", JSON.stringify(panel));

await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
    (x.querySelector(".tip")?.textContent ?? "").includes("氣象站"));
  b?.click();
});
await page.waitForFunction(() => {
  const m = window.__map;
  return m && m.getSource("vl-weather_stations") && m.querySourceFeatures("vl-weather_stations").length > 0;
}, null, { timeout: 30_000 }).catch(() => console.log("!! station source never populated"));
await page.waitForTimeout(2000);

const layer = await page.evaluate(() => {
  const map = window.__map;
  const id = "vl-weather_stations-point";
  if (!map.getLayer(id)) return { layer: false };
  const feats = map.querySourceFeatures("vl-weather_stations");
  const names = feats.map((f) => f.properties?.Name_en ?? f.properties?.Name_tc).filter(Boolean);
  return {
    layer: true,
    features: feats.length,
    icon: map.getLayoutProperty(id, "icon-image"),
    hasGlyph: map.hasImage("station-wind"),
    sampleNames: names.slice(0, 4),
    rendered: map.queryRenderedFeatures({ layers: [id] }).length,
  };
});
console.log("layer:", JSON.stringify(layer, null, 1));
console.log("errors:", errs.length ? errs.slice(0, 3) : "(none)");
await browser.close();
