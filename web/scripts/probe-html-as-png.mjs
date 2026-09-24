// probe-html-as-png.mjs — an image/png response is actually HTML. Find which URL
// returns it, and what the HTML says (it is usually a signed-URL expiry or a
// "not found" page from a CDN).
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });

const suspects = [];
page.on("response", async (r) => {
  const ct = (r.headers()["content-type"] ?? "").toLowerCase();
  if (!ct.includes("image/")) return;
  try {
    const body = await r.body();
    // PNG magic is 89 50 4e 47; JPEG is ff d8. Anything else is a lie.
    const isPng = body.length > 8 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47;
    const isJpg = body.length > 3 && body[0] === 0xff && body[1] === 0xd8;
    const isGif = body.length > 3 && body[0] === 0x47 && body[1] === 0x49 && body[2] === 0x46;
    const isWebp = body.length > 12 && body.slice(8, 12).toString() === "WEBP";
    if (!isPng && !isJpg && !isGif && !isWebp) {
      suspects.push({
        url: decodeURIComponent(r.url()).slice(-95),
        ct,
        len: body.length,
        head: body.slice(0, 120).toString("utf8").replace(/\s+/g, " ").slice(0, 110),
      });
    }
  } catch { /* body unavailable for some responses */ }
});

await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(12000);
await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("颱風"));
  b?.click();
});
await page.waitForTimeout(9000);

console.log(`\n=== responses claiming image/* but NOT an image: ${suspects.length} ===`);
for (const s of suspects) console.log(JSON.stringify(s, null, 1));
await browser.close();
