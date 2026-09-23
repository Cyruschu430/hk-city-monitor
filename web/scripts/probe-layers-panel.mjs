// probe-layers-panel.mjs — does the LAYERS control ever populate?
// Hypothesis: paintLegend() is only called from applyModeLayers(), which only
// runs for a vertical — so in overview (and for rail toggles) it stays empty.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, locale: "zh-HK" });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(9000);

const snap = () =>
  page.evaluate(() => {
    const el = document.querySelector(".layer-control");
    return {
      exists: !!el,
      hidden: el?.hidden ?? null,
      rows: [...(el?.querySelectorAll(".lyr-label") ?? [])].map((r) => r.textContent?.trim()),
      drawn: window.__hkcm?.drawnLayers?.() ?? null,
      mode: window.__hkcm?.currentMode?.() ?? null,
    };
  });

console.log("overview mode:", JSON.stringify(await snap()));

// Switch to 停水模式 (4th mode button) and re-check.
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("#rail .rail-btn")];
  const b = btns.find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("停水模式"));
  b?.click();
});
await page.waitForTimeout(9000);
console.log("water mode   :", JSON.stringify(await snap()));

// Now toggle a RAIL layer (e.g. 風場) and see whether the panel reflects it.
await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
    (x.querySelector(".tip")?.textContent ?? "").includes("風場"));
  b?.click();
});
await page.waitForTimeout(6000);
console.log("water+wind   :", JSON.stringify(await snap()));

await browser.close();
