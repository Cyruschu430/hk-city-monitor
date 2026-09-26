// 測 3D 開唔開到 —— circular dependency 警告話會 broken execution order
import { chromium } from "playwright-core";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });
const errs = [], loaded = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 220)); });
page.on("response", (r) => { const u = r.url(); if (/\.js$/.test(u)) loaded.push(u.split("/").pop()); });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
try { await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 }); } catch {}
await page.waitForTimeout(9000);
const before = loaded.length;
// 搵 3D toggle
const found = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("#mapHud button, .lyr, button")];
  const t = btns.filter((b) => /3D|樓宇|building/i.test(b.textContent + " " + (b.getAttribute("aria-label") || "") + " " + (b.title || "")));
  return t.map((b) => ({ text: b.textContent.trim().slice(0, 24), cls: b.className.slice(0, 40), tag: b.tagName }));
});
console.log("3D controls found:", JSON.stringify(found, null, 1));
const clicked = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  const t = btns.find((b) => /3D|樓宇/i.test(b.textContent + (b.getAttribute("aria-label") || "") + (b.title || "")));
  if (!t) return "none";
  t.click(); return t.textContent.trim().slice(0, 30);
});
console.log("clicked:", clicked);
await page.waitForTimeout(14000);
console.log("errors after 3D:", [...new Set(errs)].slice(0, 8));
console.log("new chunks loaded after boot:", loaded.slice(before));
console.log("deck render?", JSON.stringify(await page.evaluate(() => {
  const c = [...document.querySelectorAll("canvas")];
  return { canvases: c.length, sizes: c.map((x) => x.width + "x" + x.height) };
})));
await browser.close();
