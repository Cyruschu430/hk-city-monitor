
import { chromium } from "playwright-core";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const b = await chromium.launch({ executablePath: exe, headless: true });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });
await p.goto("http://127.0.0.1:4173/", { waitUntil: "domcontentloaded" });
await p.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 }).catch(()=>{});
await p.waitForTimeout(9000);
await p.screenshot({ path: "C:\\hk-after-dark.png" });
await p.evaluate(() => { document.documentElement.dataset.theme = "light"; });
await p.waitForTimeout(2000);
await p.screenshot({ path: "C:\\hk-after-light.png" });
// ticker crop, light theme (this is where 150 headlines used to be invisible)
await p.screenshot({ path: "C:\\hk-after-ticker.png", clip: { x: 0, y: 64, width: 1920, height: 30 } });
console.log("ok");
await b.close();
