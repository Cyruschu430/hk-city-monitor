// probe-any-html-image.mjs — find ANY response, anywhere, whose body is HTML but
// which was requested as an image (or fetched by MapLibre for decode).
import { chromium } from "playwright-core";

const target = process.argv[2] || "http://localhost:4173/";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });

const hits = [];
page.on("response", async (r) => {
  const rt = r.request().resourceType();
  const ct = (r.headers()["content-type"] ?? "").toLowerCase();
  // A decode failure means MapLibre got HTML where it wanted an image. Catch the
  // request regardless of its declared resourceType.
  if (rt !== "image" && !ct.includes("image")) return;
  try {
    const body = await r.body();
    if (body.length === 0) return;
    const head = body.slice(0, 40).toString("utf8");
    if (/<!doctype html|<html/i.test(head)) {
      hits.push({ rt, status: r.status(), ct, len: body.length, url: decodeURIComponent(r.url()).slice(0, 120) });
    }
  } catch {}
});

await page.goto(target, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(12000);
hits.length = 0;

await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("颱風"));
  b?.click();
});
await page.waitForTimeout(10000);

console.log(`\n=== image-ish responses whose body is HTML: ${hits.length} ===`);
for (const h of hits) console.log(JSON.stringify(h, null, 1));
await browser.close();
