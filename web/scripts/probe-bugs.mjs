#!/usr/bin/env node
import { chromium } from "playwright-core";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.click(".rail-btn:nth-child(2)"); // typhoon
await new Promise((r) => setTimeout(r, 12000));
const info = await page.evaluate(() => {
  const el = document.querySelector('[data-panel="rain_nowcast_map"]');
  if (!el) return null;
  return {
    state: el.dataset.state,
    footer: el.querySelector(".panel-foot time")?.textContent ?? null,
    bodyHTML: (el.querySelector(".panel-body")?.innerHTML || "").slice(0, 220),
  };
});
console.log("rain panel:", JSON.stringify(info, null, 1));
// what did the proxy actually return?
const prox = await fetch("http://127.0.0.1:8787/proxy?url=" + encodeURIComponent("https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast.csv"));
const t = await prox.text();
console.log("proxied CSV first row:", t.split(/\r?\n/)[1]);
await browser.close();