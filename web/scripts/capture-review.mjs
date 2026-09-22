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
// 總覽 settled
await page.click(".rail-btn:nth-child(1)");
await page.waitForTimeout(14_000);
await page.screenshot({ path: join(out, "r1-overview.png") });
// panels column close-up
await page.screenshot({ path: join(out, "r2-panels.png"), clip: { x: 1600 - 380, y: 40, width: 380, height: 960 } });
// map area close-up
await page.screenshot({ path: join(out, "r3-map.png"), clip: { x: 56, y: 66, width: 1600 - 56 - 380, height: 934 } });
// 颱風
await page.click(".rail-btn:nth-child(2)");
await page.waitForTimeout(9000);
await page.screenshot({ path: join(out, "r4-typhoon.png") });
// 口岸
await page.click(".rail-btn:nth-child(3)");
await page.waitForTimeout(7000);
await page.screenshot({ path: join(out, "r5-border.png") });
// mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(2500);
await page.screenshot({ path: join(out, "r6-mobile.png") });
await browser.close();
console.log("captured to", out);