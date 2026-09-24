// probe-decode-cause.mjs — confirm the InvalidStateError comes from detaching an
// <img> mid-decode during a panel repaint (panels.ts replaceWith), rather than
// from the live-probe in live.ts (which is already fixed).
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });

const decodeErrs = [];
page.on("console", (m) => {
  if (m.type() === "error" && /decode|InvalidState/i.test(m.text())) decodeErrs.push(m.text().slice(0, 120));
});

await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(8000);
console.log("baseline (no forced refresh):", decodeErrs.length);

// Force many panel repaints in quick succession — the refreshAll path replaces
// every panel node, detaching any <img> still decoding.
await page.evaluate(() => {
  for (let i = 0; i < 3; i++) window.__hkcm.refreshAll();
});
await page.waitForTimeout(6000);
console.log("after 3x refreshAll:", decodeErrs.length);

// And a mode switch, which also repaints.
await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("颱風"));
  b?.click();
});
await page.waitForTimeout(8000);
console.log("after mode switch:", decodeErrs.length);
for (const e of decodeErrs.slice(0, 5)) console.log("   " + e);
await browser.close();
