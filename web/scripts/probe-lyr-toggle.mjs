// probe-lyr-toggle.mjs — does clicking a row in the LAYERS control actually
// change the map, and does it stay in sync with the rail button?
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, locale: "zh-HK" });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(10000);

// Find the wind row in the LAYERS control and click it.
const before = await page.evaluate(() => {
  const row = document.querySelector('.layer-control .lyr-row[data-rail="wind_field"]');
  const railBtn = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
    (x.querySelector(".tip")?.textContent ?? "").includes("風場"));
  return {
    rowFound: !!row,
    rowChecked: row?.getAttribute("aria-checked"),
    railPressed: railBtn?.getAttribute("aria-pressed"),
    windLayer: !!window.__map.getLayer("vl-wind_field-point"),
  };
});
console.log("before:", JSON.stringify(before));

await page.evaluate(() => {
  document.querySelector('.layer-control .lyr-row[data-rail="wind_field"]')?.click();
});
await page.waitForTimeout(6000);

const after = await page.evaluate(() => {
  const row = document.querySelector('.layer-control .lyr-row[data-rail="wind_field"]');
  const railBtn = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
    (x.querySelector(".tip")?.textContent ?? "").includes("風場"));
  const m = window.__map;
  return {
    rowChecked: row?.getAttribute("aria-checked"),
    railPressed: railBtn?.getAttribute("aria-pressed"),
    windLayer: !!m.getLayer("vl-wind_field-point"),
    windFeatures: m.querySourceFeatures("vl-wind_field").length,
    layersOn: window.__hkcm.layersOn ? window.__hkcm.layersOn() : null,
  };
});
console.log("after :", JSON.stringify(after));

// Now toggle from the RAIL and check the row follows.
await page.evaluate(() => {
  const railBtn = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
    (x.querySelector(".tip")?.textContent ?? "").includes("風場"));
  railBtn?.click();
});
await page.waitForTimeout(2500);
const synced = await page.evaluate(() => {
  const row = document.querySelector('.layer-control .lyr-row[data-rail="wind_field"]');
  const railBtn = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
    (x.querySelector(".tip")?.textContent ?? "").includes("風場"));
  return { rowChecked: row?.getAttribute("aria-checked"), railPressed: railBtn?.getAttribute("aria-pressed") };
});
console.log("rail-toggle sync:", JSON.stringify(synced));
await browser.close();
