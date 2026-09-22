// probe-wind.mjs — do the wind barbs draw, and does the distance fade hold?
// The fade IS the honesty rule for this layer, so it gets asserted, not eyeballed.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(11_000);

const panel = await page.evaluate(() => {
  const p = document.querySelector('.panel[data-panel="wind_status"]');
  return p ? { text: p.querySelector(".panel-body")?.textContent?.trim(), state: p.dataset.state } : null;
});
console.log("panel:", JSON.stringify(panel));

await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
    (x.querySelector(".tip")?.textContent ?? "").includes("風場"));
  b?.click();
});
await page.waitForFunction(() => {
  const m = window.__map;
  return m && m.getSource("vl-wind_field") && m.querySourceFeatures("vl-wind_field").length > 0;
}, null, { timeout: 30_000 }).catch(() => console.log("!! wind source never populated"));
await page.waitForTimeout(2000);

const wind = await page.evaluate(() => {
  const map = window.__map;
  const layer = "vl-wind_field-point";
  if (!map.getLayer(layer)) return { layer: false };
  const feats = map.querySourceFeatures("vl-wind_field");
  const fades = feats.map((f) => f.properties?.fade).filter((v) => typeof v === "number");
  const near = fades.filter((v) => v > 0.9).length;
  const mid = fades.filter((v) => v > 0.3 && v <= 0.9).length;
  const far = fades.filter((v) => v <= 0.3).length;
  const ids = [...new Set(feats.map((f) => f.properties?.barbId))];
  const nearest = feats.map((f) => f.properties?.nearestKm).filter((v) => typeof v === "number");
  return {
    layer: true,
    features: feats.length,
    icon: JSON.stringify(map.getLayoutProperty(layer, "icon-image")),
    rotate: JSON.stringify(map.getLayoutProperty(layer, "icon-rotate")),
    opacity: JSON.stringify(map.getPaintProperty(layer, "icon-opacity")),
    barbImages: ids.length,
    ids,
    fadeNear: near, fadeMid: mid, fadeFar: far,
    maxNearestKm: nearest.length ? Math.max(...nearest) : null,
    minFade: fades.length ? Math.min(...fades) : null,
    hasBarbImage: map.hasImage("barb-b10"),
    hasCalm: map.hasImage("barb-calm"),
  };
});
console.log("wind:", JSON.stringify(wind, null, 1));
console.log("errors:", errs.length ? errs.slice(0, 3) : "(none)");
await browser.close();
