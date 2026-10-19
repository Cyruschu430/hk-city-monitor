import { chromium } from "playwright-core";
import { browserExe } from "./browser.mjs";
const browser = await chromium.launch({
  executablePath: browserExe(),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const hits = [];
page.on("request", (r) => { if (/specialtrafficnews/.test(r.url())) hits.push(`+${Date.now() - t0}ms REQ ${r.url().slice(-30)}`); });
page.on("requestfinished", (r) => { if (/specialtrafficnews/.test(r.url())) hits.push(`+${Date.now() - t0}ms DONE`); });
const t0 = Date.now();
await page.goto("https://hk-city-monitor.pages.dev", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
const before = await page.evaluate(() => {
  const el = document.querySelector('[data-panel="special_traffic_list"]');
  const r = el?.getBoundingClientRect();
  return { deferred: document.body.dataset["deferredPanels"], rect: r ? [Math.round(r.top), Math.round(r.height)] : null,
           text: (el?.textContent || "").replace(/\s+/g, " ").slice(0, 50) };
});
console.log("before scroll:", JSON.stringify(before), "| requests:", hits.length);
await page.evaluate(() => document.querySelector('[data-panel="special_traffic_list"]')?.scrollIntoView({ block: "center" }));
await page.waitForTimeout(8000);
const after = await page.evaluate(() => {
  const el = document.querySelector('[data-panel="special_traffic_list"]');
  const r = el?.getBoundingClientRect();
  return { deferred: document.body.dataset["deferredPanels"], rect: r ? [Math.round(r.top), Math.round(r.height)] : null,
           text: (el?.textContent || "").replace(/\s+/g, " ").slice(0, 90) };
});
console.log("after scroll:", JSON.stringify(after), "| requests:", hits.length);
console.log(hits.join(" | ") || "(no request to that host at all)");
await browser.close();
