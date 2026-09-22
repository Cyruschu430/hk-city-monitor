// capture-worldmonitor.mjs — fetch reference screenshots of the World Monitor
// dashboard so the UI/UX pass compares against the real thing instead of a
// remembered impression. Reference-only; nothing here ships.
//
// Usage: node scripts/capture-worldmonitor.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../test/artifacts/reference");
mkdirSync(out, { recursive: true });

const TARGETS = [
  { name: "wm-dashboard", url: "https://www.worldmonitor.app/dashboard" },
  { name: "wm-dashboard-finance", url: "https://finance.worldmonitor.app/dashboard" },
];

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

for (const t of TARGETS) {
  try {
    await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    // The dashboard renders progressively; give the map + panels time to settle.
    await page.waitForTimeout(12_000);
    await page.screenshot({ path: resolve(out, `${t.name}.png`) });
    // Also capture the panel column alone — panel density is the thing being
    // borrowed, so it needs to be readable rather than scaled to 1600px wide.
    const aside = await page.$("aside, .sidebar, [class*=panel], [class*=sidebar]");
    if (aside) {
      const box = await aside.boundingBox();
      if (box && box.width > 120) {
        await page.screenshot({ path: resolve(out, `${t.name}-column.png`), clip: box });
      }
    }
    console.log(`✓ ${t.name}`);
  } catch (err) {
    console.log(`✗ ${t.name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

await browser.close();
console.log(`→ ${out}`);
