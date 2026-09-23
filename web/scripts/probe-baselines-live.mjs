// probe-baselines-live.mjs — confirm the app reads the persisted baseline store
// and reports the accumulating state from REAL data rather than a placeholder.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, locale: "zh-HK" });

const net = [];
page.on("response", (r) => {
  if (r.url().includes("baselines")) net.push(`${r.status()} ${r.url().slice(-40)}`);
});

await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForSelector('.panel[data-panel="analysis_brief"]', { timeout: 60_000 }).catch(() => {});
await page.waitForTimeout(4000);

const r = await page.evaluate(() => {
  const el = document.querySelector('.panel[data-panel="analysis_brief"]');
  const hk = window.__hkcm;
  return {
    acc: [...(el?.querySelectorAll(".an-acc") ?? [])].map((x) => x.textContent?.trim()),
    facts: [...(el?.querySelectorAll(".an-fact") ?? [])].map((x) => x.textContent?.trim()),
    hasStore: !!(hk?.baselineStore?.signals) || "no hook",
  };
});
console.log("baselines fetch:", net.length ? net.join("\n") : "(NONE — app never asked)");
console.log("accumulating:", JSON.stringify(r.acc, null, 1));
console.log("facts:", JSON.stringify(r.facts));
await browser.close();
