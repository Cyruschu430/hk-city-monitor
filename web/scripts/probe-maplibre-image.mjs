// probe-maplibre-image.mjs — MapLibre is fetching an image URL that 404s to the
// SPA's index.html. Log every image-typed request MapLibre makes so we can name
// the URL it is missing.
import { chromium } from "playwright-core";

const target = process.argv[2] || "http://localhost:4173/";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });

const reqs = [];
page.on("response", async (r) => {
  try {
    const ct = (r.headers()["content-type"] ?? "").toLowerCase();
    // Same-origin requests that are NOT html/js/css but asked for as images.
    const sameOrigin = r.url().startsWith(new URL(target).origin);
    if (!sameOrigin) return;
    if (ct.includes("text/html") && !r.url().endsWith("/")) {
      const body = await r.body();
      const looksHtml = /<!doctype html/i.test(body.slice(0, 40).toString("utf8"));
      if (looksHtml) reqs.push({ url: r.url().replace(new URL(target).origin, ""), ct, len: body.length, rt: r.request().resourceType() });
    }
  } catch {}
});

await page.goto(target, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(12000);
await page.evaluate(() => { window.__x = 0; });
reqs.length = 0;

await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("颱風"));
  b?.click();
});
await page.waitForTimeout(10000);

console.log(`\n=== same-origin HTML responses for non-navigation requests: ${reqs.length} ===`);
for (const r of reqs) console.log(JSON.stringify(r));
await browser.close();
