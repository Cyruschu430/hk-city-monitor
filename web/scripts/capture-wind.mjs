// capture-wind.mjs — visual check of the wind barb layer, zoomed to the
// stations so the barbs and their fade are actually visible.
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

// Hide the camera clusters so the barbs are not competing for attention in the
// review shot (they are the densest thing on the map).
await page.evaluate(() => {
  const map = window.__map;
  for (const id of ["cameras-td-cluster", "cameras-td-count", "cameras-td-point"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  }
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
    (x.querySelector(".tip")?.textContent ?? "").includes("風場"));
  b?.click();
});
await page.waitForFunction(() => {
  const m = window.__map;
  return m && m.getSource("vl-wind_field") && m.querySourceFeatures("vl-wind_field").length > 0;
}, null, { timeout: 30_000 }).catch(() => console.log("!! wind source never populated"));

// Zoom in so individual barbs are legible.
await page.evaluate(() => window.__map.jumpTo({ center: [114.10, 22.32], zoom: 10.6 }));
await page.waitForTimeout(4500);
await page.screenshot({ path: join(out, "wind-barbs.png") });
await page.screenshot({ path: join(out, "wind-barbs-zoom.png"), clip: { x: 330, y: 240, width: 620, height: 460 } });
console.log("captured");
await browser.close();
