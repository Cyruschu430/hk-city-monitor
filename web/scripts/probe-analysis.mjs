// probe-analysis.mjs — does the Tier 0-4 pipeline actually produce a brief in
// the running app, and does the panel render it? A pipeline that only works in
// unit tests is not shipped.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });

// The pipeline runs every 30s; wait for the panel to appear rather than guess.
await page.waitForSelector('.panel[data-panel="analysis_brief"]', { timeout: 60_000 }).catch(() => {});
await page.waitForTimeout(3000);

const out = await page.evaluate(() => {
  const p = document.querySelector('.panel[data-panel="analysis_brief"]');
  if (!p) return { panel: false };
  const facts = [...p.querySelectorAll(".an-fact")].map((e) => e.textContent?.trim());
  const convs = [...p.querySelectorAll(".an-conv")].map((e) => e.textContent?.trim());
  const acc = [...p.querySelectorAll(".an-acc")].map((e) => e.textContent?.trim());
  return {
    panel: true,
    chip: p.querySelector(".chip")?.textContent?.trim(),
    empty: p.querySelector(".p-empty")?.textContent?.trim() ?? null,
    facts,
    convs,
    acc,
    rules: [...p.querySelectorAll(".an-rule")].map((e) => e.textContent?.trim()),
    foot: p.querySelector(".panel-foot .src")?.textContent?.trim(),
    state: p.dataset.state,
  };
});
console.log(JSON.stringify(out, null, 1));
console.log("console errors:", errs.length ? errs.slice(0, 4) : "(none)");
await browser.close();
