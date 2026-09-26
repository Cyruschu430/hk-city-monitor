import { chromium } from "playwright-core";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });
const bad = [], errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
page.on("response", (r) => { if (r.status() >= 400) bad.push(`HTTP ${r.status()} ${r.url().slice(0, 90)}`); });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
try { await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 }); } catch {}
await page.waitForTimeout(20000);
console.log(JSON.stringify(await page.evaluate(() => {
  const p = document.querySelector('[data-panel="carpark_vacancy_list"]');
  const rows = [...(p?.querySelectorAll("tbody tr") ?? [])];
  return {
    found: !!p, state: p?.dataset.state,
    rowCount: rows.length,
    firstRows: rows.slice(0, 3).map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent.trim()).join(" | ")),
    headers: [...(p?.querySelectorAll("thead th") ?? [])].map((t) => t.textContent.trim()),
    anyDash: rows.filter((r) => r.textContent.includes("—")).length,
    chip: p?.querySelector(".chip")?.textContent,
    hasBasicInfoRequest: performance.getEntriesByType("resource").some((e) => e.name.includes("basic_info_all")),
    hasLocalRequest: performance.getEntriesByType("resource").some((e) => e.name.includes("carpark_info.json")),
  };
}), null, 1));
console.log("errors:", [...new Set(errs)].slice(0, 4));
console.log("4xx:", [...new Set(bad)].slice(0, 4));
await browser.close();
