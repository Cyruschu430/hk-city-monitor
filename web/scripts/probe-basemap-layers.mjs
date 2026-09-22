// probe-basemap-layers.mjs — find WHICH layer is holding the basemap bright.
//
// The prior probe showed luma barely moving (91 → 87) despite an aggressive
// brightness window, which means something else is contributing most of the
// light. Toggle each layer off in turn and measure; guessing which one it is
// wastes build cycles.
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

async function measure(label) {
  const buf = await page.screenshot({ clip: { x: 700, y: 300, width: 160, height: 120 } });
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
    return { luma: Math.round(0.2126 * r + 0.7152 * g + 0.0722 * bl), rgb: [Math.round(r), Math.round(g), Math.round(bl)] };
  }, buf.toString("base64"));
  console.log(`${label.padEnd(34)} luma=${String(stat.luma).padStart(3)}  rgb=${stat.rgb.join(",")}`);
  return stat.luma;
}

const base = await measure("all layers on (current)");

// The four candidates that can contribute light in that patch.
for (const id of ["landsd-label-tc", "landsd-topo", "vl-water_suspension_districts-fill"]) {
  const existed = await page.evaluate((lid) => {
    const m = window.__map;
    if (!m.getLayer(lid)) return false;
    m.setLayoutProperty(lid, "visibility", "none");
    return true;
  }, id);
  if (!existed) { console.log(`${id.padEnd(34)} (not present)`); continue; }
  await page.waitForTimeout(1500);
  await measure(`without ${id}`);
  await page.evaluate((lid) => window.__map.setLayoutProperty(lid, "visibility", "visible"), id);
  await page.waitForTimeout(1200);
}

console.log(`\nbaseline luma = ${base}`);
await b2.close();
await browser.close();
console.log("artifacts →", out);
