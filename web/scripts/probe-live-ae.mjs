// probe-live-ae.mjs — does the DEPLOYED A&E panel show an update time?
//
// The parser is verified against the live feed directly (observedAt 18:15 HKT).
// This checks the thing the user actually sees: the panel's own footer. A bundle
// grep cannot answer it — minification renames the function, so searching the
// shipped JS for `parseHkChineseDate` returns false and proves nothing (the same
// mistake as grepping for 模式格網, which esbuild escapes to \u sequences).
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const url = process.argv[2] ?? "https://hk-city-monitor.pages.dev/";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, locale: "zh-HK" });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.evaluate(() => {
  [...document.querySelectorAll("#rail .rail-btn")]
    .find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("總覽"))?.click();
});
await page
  .waitForFunction(
    () => document.querySelector('[data-panel="ae_waiting_grid"]')?.dataset.state !== "loading",
    null,
    { timeout: 60_000 },
  )
  .catch(() => {});
await page.waitForTimeout(2000);

const out = await page.evaluate(() => {
  const p = document.querySelector('[data-panel="ae_waiting_grid"]');
  if (!p) return { err: "no A&E panel" };
  return {
    state: p.dataset.state,
    // Whatever the panel uses to state its observation time.
    footer: (p.querySelector(".panel-time, .panel-foot, footer, .p-time")?.textContent ?? "").trim().slice(0, 60),
    full: p.textContent.replace(/\s+/g, " ").slice(-160),
  };
});
console.log(JSON.stringify(out, null, 1));
const hasTime = /\d{1,2}:\d{2}/.test(out.footer ?? "") || /\d{1,2}:\d{2}/.test(out.full ?? "");
console.log(hasTime ? "\nPASS: the panel states an observation time" : "\nFAIL: no time shown");
await browser.close();
process.exit(hasTime ? 0 : 1);
