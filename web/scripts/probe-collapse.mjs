// probe-collapse.mjs — is the row cap actually reaching the renderer?
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(10_000);

const r = await page.evaluate(() => {
  const out = {};
  for (const id of ["special_traffic_list", "water_suspension_list", "breaking_news_list"]) {
    const el = document.querySelector(`.panel[data-panel="${id}"]`);
    if (!el) { out[id] = "MISSING"; continue; }
    const lis = [...el.querySelectorAll(".plist li")];
    out[id] = {
      items: lis.length,
      more: !!el.querySelector(".p-more"),
      moreText: el.querySelector(".p-more")?.textContent ?? null,
      collapsed: !!el.querySelector(".p-collapsed"),
      height: Math.round(el.getBoundingClientRect().height),
      // Per-row height + characters, to tell "too many rows" apart from
      // "each row is enormous" — the two need opposite fixes.
      rowHeights: lis.slice(0, 4).map((l) => Math.round(l.getBoundingClientRect().height)),
      rowChars: lis.slice(0, 4).map((l) => (l.textContent ?? "").trim().length),
      firstRow: (lis[0]?.textContent ?? "").trim().slice(0, 120),
    };
  }
  return out;
});
console.log(JSON.stringify(r, null, 2));
await browser.close();
