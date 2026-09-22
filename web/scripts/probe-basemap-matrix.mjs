// probe-basemap-matrix.mjs — settle the basemap paint empirically instead of by
// reasoning about MapLibre's raster model (two attempts in a row went the
// WRONG way, which means the model in my head is wrong, not the code).
//
// Applies candidate paint sets to the live topo layer via setPaintProperty and
// measures the rendered luma of a land patch. No rebuild per row.
import { chromium } from "playwright-core";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../test/artifacts/reference");
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(8000);

const b2 = await chromium.launch({ executablePath: exe, headless: true });
const p2 = await b2.newPage();

async function measure() {
  const buf = await page.screenshot({ clip: { x: 700, y: 300, width: 160, height: 120 } });
  return p2.evaluate(async (data) => {
    const img = new Image();
    img.src = "data:image/png;base64," + data;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, bl = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; }
    r /= n; g /= n; bl /= n;
    return { luma: Math.round(0.2126 * r + 0.7152 * g + 0.0722 * bl), rgb: [Math.round(r), Math.round(g), Math.round(bl)] };
  }, buf.toString("base64"));
}

// Each row: [label, paint property map]. null value = reset to default.
const ROWS = [
  ["baseline (as built)", { "raster-opacity": 0.5, "raster-contrast": 0.25, "raster-saturation": -0.6 }],
  ["+ brightness-max 0.22", { "raster-brightness-max": 0.22 }],
  ["+ brightness-max 0.5", { "raster-brightness-max": 0.5 }],
  ["brightness-max 0.22 only", { "raster-opacity": null, "raster-contrast": null, "raster-saturation": null }],
  ["opacity 0.25 + bmax 0.6", { "raster-opacity": 0.25, "raster-brightness-max": 0.6, "raster-contrast": null, "raster-saturation": -0.6 }],
  ["opacity 0.35 + bmax 0.45 + contrast 0.3", { "raster-opacity": 0.35, "raster-brightness-max": 0.45, "raster-contrast": 0.3, "raster-saturation": -0.6 }],
  ["opacity 0.3 + bmax 0.35 + contrast 0.3", { "raster-opacity": 0.3, "raster-brightness-max": 0.35, "raster-contrast": 0.3, "raster-saturation": -0.6 }],
];

console.log("row".padEnd(44) + "luma  rgb");
const results = [];
for (const [label, paint] of ROWS) {
  await page.evaluate((p) => {
    const m = window.__map;
    for (const [k, v] of Object.entries(p)) {
      if (v === null) m.setPaintProperty("landsd-topo", k, undefined);
      else m.setPaintProperty("landsd-topo", k, v);
    }
  }, paint);
  await page.waitForTimeout(1600);
  const stat = await measure();
  console.log(label.padEnd(44) + String(stat.luma).padStart(4) + "  " + stat.rgb.join(","));
  results.push({ label, ...stat });
}

await b2.close();
await browser.close();
// Best = darkest that still keeps some structure (luma > 15 so it isn't black).
const dark = results.filter((r) => r.luma > 15).sort((a, b) => a.luma - b.luma)[0];
console.log(`\ndarkest with structure: ${dark.label} luma=${dark.luma}`);
console.log("note: World Monitor's basemap sits far darker; target luma 30-55.");
