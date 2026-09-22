// probe-basemap.mjs — measure the basemap's rendered appearance.
//
// Why a screenshot and not canvas.getImageData: MapLibre runs with
// preserveDrawingBuffer:false, so reading the WebGL canvas after the frame
// returns all-zero pixels (measured — first version of this probe reported
// pure black for both sea and land). A screenshot goes through the compositor
// and is the only honest readback. The PNG is decoded with sharp, which is
// already present transitively via the capture tooling.
import { chromium } from "playwright-core";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../test/artifacts/reference");
mkdirSync(out, { recursive: true });

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(9000);

const paint = await page.evaluate(() => {
  const m = window.__map;
  return {
    saturation: m.getPaintProperty("landsd-topo", "raster-saturation"),
    brightness: m.getPaintProperty("landsd-topo", "raster-brightness-max"),
    contrast: m.getPaintProperty("landsd-topo", "raster-contrast"),
  };
});

// Two patches chosen to contain NO overlay: open sea bottom-left, and inland
// terrain in the north-east. Landing a patch on a camera cluster would measure
// the overlay, not the basemap.
const shot = resolve(out, "_probe-patches.png");
await page.screenshot({ path: shot, clip: { x: 60, y: 760, width: 120, height: 80 } });
await page.screenshot({ path: resolve(out, "_probe-land.png"), clip: { x: 700, y: 300, width: 160, height: 120 } });

await browser.close();

// Mean RGB of a PNG, via the browser we already have (no new dependency).
const decode = async (file) => {
  const b64 = readFileSync(file).toString("base64");
  const b2 = await chromium.launch({ executablePath: exe, headless: true });
  const p2 = await b2.newPage();
  const stat = await p2.evaluate(async (data) => {
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
    return { r: Math.round(r), g: Math.round(g), b: Math.round(bl),
             spread: Math.round(Math.max(r, g, bl) - Math.min(r, g, bl)),
             luma: Math.round(0.2126 * r + 0.7152 * g + 0.0722 * bl) };
  }, b64);
  await b2.close();
  return stat;
};

const sea = await decode(shot);
const land = await decode(resolve(out, "_probe-land.png"));
console.log(JSON.stringify({ paint, sea, land }, null, 2));
