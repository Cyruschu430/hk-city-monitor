// capture-aircraft.mjs — visual check of the aircraft layer, zoomed to where
// the planes actually are.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "artifacts", "review");
mkdirSync(out, { recursive: true });
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(10_000);

await page.evaluate(() => {
  // Layer buttons label themselves via a `.tip` span — selecting on `title`
  // matches nothing and silently clicks an unrelated control.
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
    (x.querySelector(".tip")?.textContent ?? "").includes("航機"),
  );
  b?.click();
});
// Wait for data rather than sleeping a fixed amount.
await page.waitForFunction(() => {
  const m = window.__map;
  return m && m.getSource("vl-aircraft") && m.querySourceFeatures("vl-aircraft").length > 0;
}, null, { timeout: 30_000 }).catch(() => console.log("!! source never populated"));
await page.waitForTimeout(2500);

// Fit the map to the aircraft so they are not all off-screen.
const box = await page.evaluate(() => {
  const map = window.__map;
  const feats = map.querySourceFeatures("vl-aircraft");
  if (feats.length === 0) return null;
  const lons = feats.map((f) => f.geometry.coordinates[0]);
  const lats = feats.map((f) => f.geometry.coordinates[1]);
  const b = [
    [Math.min(...lons) - 0.3, Math.min(...lats) - 0.25],
    [Math.max(...lons) + 0.3, Math.max(...lats) + 0.25],
  ];
  map.fitBounds(b, { duration: 0, padding: 120 });
  return { n: feats.length, sw: b[0], ne: b[1] };
});
console.log("fitted:", JSON.stringify(box));
await page.waitForTimeout(5000);
await page.screenshot({ path: join(out, "aircraft-map.png") });
await page.screenshot({ path: join(out, "aircraft-panel.png"), clip: { x: 1220, y: 40, width: 380, height: 500 } });
await browser.close();
console.log("→", out);
