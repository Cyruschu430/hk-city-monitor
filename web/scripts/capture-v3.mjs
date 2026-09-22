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
await page.click(".rail-btn:nth-child(1)"); // overview
await page.waitForTimeout(13_000);
await page.screenshot({ path: join(out, "v3-overview.png") });
await page.screenshot({ path: join(out, "v3-ticker.png"), clip: { x: 0, y: 40, width: 1220, height: 30 } });
await page.screenshot({ path: join(out, "v3-panels.png"), clip: { x: 1220, y: 40, width: 380, height: 960 } });

// water mode — the district highlight + name labels live here
await page.click(".rail-btn:nth-child(4)");
await page.waitForTimeout(7000);
await page.screenshot({ path: join(out, "v3-water.png") });
// focus HUD: click a camera
await page.evaluate(async () => {
  const map = window.__map;
  let feats = map.queryRenderedFeatures({ layers: ["cameras-td-point"] });
  if (!feats.length) { map.zoomTo(13, { duration: 0 }); await new Promise((r) => setTimeout(r, 1800)); feats = map.queryRenderedFeatures({ layers: ["cameras-td-point"] }); }
  const f = feats[0];
  const [lon, lat] = f.geometry.coordinates;
  map.fire("click", { point: map.project([lon, lat]), lngLat: { lng: lon, lat }, features: [f] });
});
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, "v3-hud.png") });
await browser.close();
console.log("captured v3 set");