// probe-mapchrome.mjs — measure the actual boxes of everything pinned to the
// bottom of the map face, so the LAYERS control is placed from geometry rather
// than by nudging a CSS value and re-screenshotting.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(4000);
// water mode has the most layers, so it is the worst case for the control
await page.click(".rail-btn:nth-child(4)").catch(() => {});
await page.waitForTimeout(9000);

const geo = await page.evaluate(() => {
  const map = document.getElementById("map");
  if (!map) return { err: "no #map" };
  const mb = map.getBoundingClientRect();
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      sel,
      top: Math.round(r.top - mb.top),
      bottom: Math.round(mb.bottom - r.bottom), // distance UP from the map's bottom edge
      left: Math.round(r.left - mb.left),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  };
  return {
    mapHeight: Math.round(mb.height),
    scale: pick(".maplibregl-ctrl-scale"),
    attribution: pick(".maplibregl-ctrl-attrib"),
    layers: pick(".layer-control"),
    coords: pick(".map-coords"),
    navCtrl: pick(".maplibregl-ctrl-top-right"),
    mapHead: pick("#mapHead"),
  };
});
console.log(JSON.stringify(geo, null, 2));
await browser.close();
