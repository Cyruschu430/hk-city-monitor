// capture-analysis.mjs — visual check of the analysis panel with real data.
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
await page.waitForSelector('.panel[data-panel="analysis_brief"]', { timeout: 60_000 }).catch(() => {});
await page.waitForTimeout(2500);

const box = await page.evaluate(() => {
  const p = document.querySelector('.panel[data-panel="analysis_brief"]');
  if (!p) return null;
  p.scrollIntoView({ block: "center" });
  return true;
});
console.log("panel found:", box);
await page.waitForTimeout(1200);
await page.screenshot({ path: join(out, "analysis-panel.png"), clip: { x: 1258, y: 40, width: 342, height: 960 } });
console.log("->", out);
await browser.close();
