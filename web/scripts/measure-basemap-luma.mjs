// measure-basemap-luma.mjs — sample the map face and report its mean luma.
//
// WHY THIS EXISTS: style.json's basemap paint was tuned against a measured luma table (~35, very
// dark) and Cyrus's verdict on the live site was "有啲暗太過黑". A number that was measured once
// and then edited has to be measured again — the comment block in sync-data.mjs claims specific
// luma values, and a claim about a rendering is not something to assert from the paint values.
//
//   node scripts/measure-basemap-luma.mjs            # topo (default basemap)
//   node scripts/measure-basemap-luma.mjs imagery    # aerial
//
// It clips to the MAP panel only, below the placard, so the header, the panel column and the
// always-dark badges are excluded: this measures the basemap, not the page.
import { chromium } from "playwright-core";

const exe = process.env.CHROME_PATH ?? process.env.HKCM_CHROME
  ?? "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const BASE = process.env.HKCM_URL ?? process.env.BASE ?? "http://localhost:4173/";
const kind = process.argv[2] ?? "topo";

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "zh-HK" });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
try { await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 }); }
catch { console.log("FAIL the app never booted"); await browser.close(); process.exit(1); }
// Basemap tiles arrive after boot; 6s is what the other checks allow for the map to settle.
await page.waitForTimeout(6000);

const shot = await page.screenshot({ clip: await page.evaluate(() => {
  const m = document.getElementById("map").getBoundingClientRect();
  // Trim the placard strip at the top and the badge strip at the bottom.
  return { x: m.x + m.width * 0.25, y: m.y + 90, width: m.width * 0.5, height: Math.max(80, m.height - 190) };
}) });
await browser.close();

// Mean luma from the PNG. Node has no image decoder in stdlib, so shell out to python for the
// pixels rather than adding a dependency to a project that keeps its dependency list tiny.
const fs = await import("node:fs");
const { execFileSync } = await import("node:child_process");
const tmp = process.env.TEMP ? `${process.env.TEMP}\\luma.png` : "/tmp/luma.png";
fs.writeFileSync(tmp, shot);
const out = execFileSync("python", ["-c", `
from PIL import Image
import sys
im = Image.open(sys.argv[1]).convert("RGB")
px = list(im.getdata())
lum = [0.2126*r + 0.7152*g + 0.0722*b for r, g, b in px]
lum.sort()
print("%.1f %.1f %.1f %d" % (sum(lum)/len(lum), lum[len(lum)//2], lum[int(len(lum)*0.9)], len(lum)))
`, tmp], { encoding: "utf8" }).trim().split(" ");

console.log(`basemap ${kind}: mean luma ${out[0]}  median ${out[1]}  p90 ${out[2]}  (${out[3]} px sampled)`);
console.log("reference: the paint comment in sync-data.mjs recorded luma ~35 for the old topo values,"
  + " and DESIGN_BRIEF's dark-console target is a face the labels stay readable on, not a black one.");
