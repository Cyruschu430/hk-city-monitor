// probe-small-html-png.mjs — a 2551-byte blob typed image/png is HTML. Capture
// the URL by watching every response whose bytes are HTML but whose type claims
// an image. Radar is now a data URL, so this is a different request.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });

// Record EVERY response with its byte-level verdict, not just image/* ones.
const all = [];
page.on("response", async (r) => {
  try {
    const ct = (r.headers()["content-type"] ?? "").toLowerCase();
    const body = await r.body();
    if (body.length === 0) return;
    const head = body.slice(0, 20).toString("utf8");
    const looksHtml = /^\s*<(!doctype|html)/i.test(head);
    const claimsImage = ct.includes("image/");
    // Capture anything suspicious: HTML behind an image type, OR exactly the
    // 2551-byte size we saw.
    if ((claimsImage && looksHtml) || body.length === 2551) {
      all.push({
        url: decodeURIComponent(r.url()).slice(-95),
        status: r.status(),
        ct,
        len: body.length,
        head: body.slice(0, 90).toString("utf8").replace(/\s+/g, " "),
      });
    }
  } catch { /* some bodies are unavailable */ }
});

await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(12000);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("颱風"));
  b?.click();
});
await page.waitForTimeout(10000);

console.log(`\n=== suspicious responses: ${all.length} ===`);
for (const s of all) console.log(JSON.stringify(s, null, 1));
await browser.close();
