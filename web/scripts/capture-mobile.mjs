// capture-mobile.mjs — the harness screenshots 04-mobile.png after restoring
// the desktop viewport, so the mobile layout needs its own capture to be
// actually reviewable. Checks the coverage line too, since the status bar
// gained a second row in this pass.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "artifacts", "review");
mkdirSync(out, { recursive: true });
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });

for (const [name, w, h] of [["m390", 390, 844], ["m430", 430, 932]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, locale: "zh-HK" });
  await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
  await page.waitForTimeout(11_000);
  const info = await page.evaluate(() => {
    const sb = document.getElementById("statusbar");
    const cov = document.querySelector(".coverage");
    const row1 = document.querySelector(".sb-row1");
    return {
      statusbarScrollW: sb.scrollWidth,
      innerW: window.innerWidth,
      row1H: Math.round(row1?.getBoundingClientRect().height ?? 0),
      sbH: Math.round(sb.getBoundingClientRect().height),
      coverText: cov?.textContent?.trim() ?? "",
      coverScrollW: cov?.scrollWidth ?? 0,
      docScrollW: document.documentElement.scrollWidth,
    };
  });
  console.log(name, JSON.stringify(info));
  await page.screenshot({ path: join(out, `${name}-full.png`) });
  await page.screenshot({ path: join(out, `${name}-statusbar.png`), clip: { x: 0, y: 0, width: w, height: 70 } });
  await page.close();
}
await browser.close();
console.log("→", out);
