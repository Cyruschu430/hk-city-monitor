// probe-aircraft.mjs — does the aircraft layer actually draw, and are the
// planes rotated by their real track? A symbol layer can be "present" while
// drawing nothing (a bad icon-image id, a filter that matches no feature), so
// this asserts rendered features AND reads icon-rotate back.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(12_000);

// The aircraft rail toggle is the 3rd layer button.
const before = await page.evaluate(() => ({
  panel: !!document.querySelector('.panel[data-panel="aircraft_status"]'),
  panelText: document.querySelector('.panel[data-panel="aircraft_status"] .panel-body')?.textContent?.trim() ?? "",
  layer: !!window.__map?.getLayer("vl-aircraft-point"),
}));
console.log("before toggle:", JSON.stringify(before));

// Turn it on via the rail.
const clicked = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("#rail button")];
  const b = btns.find((x) => (x.getAttribute("title") ?? "").includes("航機") || (x.textContent ?? "").includes("航機"));
  if (b) { b.click(); return true; }
  return false;
});
console.log("toggled aircraft:", clicked);
await page.waitForTimeout(6000);

const after = await page.evaluate(() => {
  const map = window.__map;
  const id = "vl-aircraft-point";
  const out = { layer: !!map.getLayer(id), src: !!map.getSource("vl-aircraft") };
  if (out.src) {
    const src = map.getSource("vl-aircraft");
    out.featureCount = map.querySourceFeatures("vl-aircraft").length;
    out.rendered = map.queryRenderedFeatures({ layers: [id] }).length;
    out.rotate = map.getLayoutProperty(id, "icon-rotate");
    out.icon = map.getLayoutProperty(id, "icon-image");
    out.hasImage = map.hasImage("plane");
    // bearings actually present on the features
    out.bearings = map.querySourceFeatures("vl-aircraft").slice(0, 5).map((f) => f.properties?.bearing);
    out.callsigns = map.querySourceFeatures("vl-aircraft").slice(0, 5).map((f) => f.properties?.flight);
    void src;
  }
  return out;
});
console.log("after toggle:", JSON.stringify(after, null, 2));
console.log("console errors:", errors.length ? errors.slice(0, 4) : "(none)");
await browser.close();
