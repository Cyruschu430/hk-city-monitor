import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "artifacts", "review");
mkdirSync(out, { recursive: true });
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "en-US" });
try {
  await page.goto("https://www.worldmonitor.app/", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(15_000);
  await page.screenshot({ path: join(out, "wm1-home.png") });
  await page.waitForTimeout(5_000);
  await page.screenshot({ path: join(out, "wm2-settled.png") });
  console.log("title:", await page.title());
  console.log("captured");
} catch (e) {
  console.log("FAILED:", e.message);
}
await browser.close();