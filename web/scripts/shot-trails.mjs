// shot-trails.mjs — a picture of the hiking-trail colours, for a human to judge.
//
// The change under review is a colour ramp, and no assertion settles whether six colours are
// actually distinguishable. Enable the layer, fit the view to the trails, screenshot the map.
import { chromium } from "playwright-core";
import { browserExe } from "./browser.mjs";

const base = process.argv[2] ?? "https://hk-city-monitor.pages.dev";
const out = process.argv[3] ?? "/tmp/trails.png";
const browser = await chromium.launch({
  executablePath: browserExe(),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, locale: "zh-HK" });
await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => !!window.__map, null, { timeout: 90000 });
await page.waitForTimeout(5000);

await page.evaluate(() => {
  const btn = document.querySelector('.lyr-item[data-row="hiking_trails"] .lyr-row');
  btn?.click();
});
await page.waitForFunction(() => !!window.__map?.getSource("vl-hiking_trails"), null, { timeout: 40000 }).catch(() => {});
await page.evaluate(() => {
  const feats = window.__map?.getSource("vl-hiking_trails")?._data?.features ?? [];
  let minX = 180, minY = 90, maxX = -180, maxY = -90;
  const walk = (c) => {
    if (typeof c[0] === "number") {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    } else for (const x of c) walk(x);
  };
  for (const f of feats) walk(f.geometry?.coordinates ?? []);
  if (minX < maxX) window.__map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 30, duration: 0 });
});
await page.waitForTimeout(5000);

const stats = await page.evaluate(() => {
  const feats = window.__map?.getSource("vl-hiking_trails")?._data?.features ?? [];
  const rendered = window.__map?.queryRenderedFeatures({ layers: ["vl-hiking_trails-line"] }) ?? [];
  return {
    features: feats.length,
    colours: [...new Set(feats.map((f) => f.properties?.color))],
    rendered: rendered.length,
    renderedColours: [...new Set(rendered.map((f) => f.layer?.paint?.["line-color"]))],
  };
});
console.log("rendered:", JSON.stringify(stats));

const box = await page.evaluate(() => {
  const el = document.querySelector(".map-band") ?? document.querySelector("#map") ?? document.querySelector(".maplibregl-map");
  const r = el?.getBoundingClientRect();
  return r ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : null;
});
await page.screenshot({ path: out, clip: box ?? undefined });
console.log("shot:", out, box ? JSON.stringify(box) : "(full page)");
await browser.close();
