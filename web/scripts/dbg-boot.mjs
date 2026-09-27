import { chromium } from "playwright-core";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });
const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERROR: " + String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 250)); });
page.on("requestfailed", (r) => errs.push("REQFAIL: " + r.url().slice(0, 90) + " " + (r.failure()?.errorText ?? "")));
let resp = null;
try { resp = await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 30000 }); } catch (e) { errs.push("GOTO: " + String(e).slice(0, 150)); }
console.log("HTTP:", resp?.status());
for (let i = 0; i < 30; i++) {
  const st = await page.evaluate(() => ({ ready: document.body.dataset.ready, panels: document.querySelectorAll("[data-panel]").length, html: document.body.innerHTML.length }));
  if (i % 6 === 0) console.log(`  +${i}s ready=${st.ready} panels=${st.panels} htmlLen=${st.html}`);
  if (st.ready === "1") { console.log(`  BOOTED at +${i}s`); break; }
  await page.waitForTimeout(1000);
}
console.log("\n錯誤:");
for (const e of [...new Set(errs)].slice(0, 12)) console.log("  " + e);
await browser.close();
