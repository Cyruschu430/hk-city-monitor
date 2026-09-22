// probe-aircraft2.mjs — the layer exists and has 14 features but paints (almost)
// nothing. Find out WHY rather than guessing: check source data, feature
// geometry, whether the icon resolves, and paint after fitting the map to the
// aircraft.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(11_000);

await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail button")].find((x) => (x.getAttribute("title") ?? "").includes("航機"));
  b?.click();
});
// Wait for the SOURCE to have data, not a fixed sleep.
await page.waitForFunction(() => {
  const m = window.__map;
  return m && m.getSource("vl-aircraft") && m.querySourceFeatures("vl-aircraft").length > 0;
}, null, { timeout: 30_000 }).catch(() => console.log("!! source never populated"));

const diag = await page.evaluate(() => {
  const map = window.__map;
  const id = "vl-aircraft-point";
  const feats = map.querySourceFeatures("vl-aircraft");
  const b = map.getBounds();
  const inView = feats.filter((f) => b.contains(f.geometry.coordinates));
  return {
    features: feats.length,
    inView: inView.length,
    firstCoords: feats.slice(0, 3).map((f) => f.geometry.coordinates),
    center: [map.getCenter().lng, map.getCenter().lat],
    zoom: map.getZoom(),
    bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
    layerVisible: map.getLayoutProperty(id, "visibility") ?? "visible",
    iconSize: JSON.stringify(map.getLayoutProperty(id, "icon-size")),
    hasPlaneImage: map.hasImage("plane"),
    // The decisive one: does MapLibre consider the features PAINTED?
    renderedNow: map.queryRenderedFeatures({ layers: [id] }).length,
  };
});
console.log(JSON.stringify(diag, null, 2));

// Fit to the aircraft and re-measure.
await page.evaluate(() => {
  const map = window.__map;
  const feats = map.querySourceFeatures("vl-aircraft");
  if (!feats.length) return;
  const pts = feats.map((f) => f.geometry.coordinates);
  map.fitBounds(
    [[Math.min(...pts.map((p) => p[0])) - 0.25, Math.min(...pts.map((p) => p[1])) - 0.2],
     [Math.max(...pts.map((p) => p[0])) + 0.25, Math.max(...pts.map((p) => p[1])) + 0.2]],
    { duration: 0 },
  );
});
await page.waitForTimeout(4000);
const after = await page.evaluate(() => ({
  zoom: window.__map.getZoom(),
  rendered: window.__map.queryRenderedFeatures({ layers: ["vl-aircraft-point"] }).length,
}));
console.log("after fitBounds:", JSON.stringify(after));
await browser.close();
