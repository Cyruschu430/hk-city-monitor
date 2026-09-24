// probe-decode-impact.mjs — quantify the decode error's actual user impact.
// Is anything visibly broken, or is this console noise from an internal probe?
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });

const decodeErrs = [];
page.on("console", (m) => { if (/decode/i.test(m.text())) decodeErrs.push(m.text()); });

await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(12000);

await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("颱風"));
  b?.click();
});
await page.waitForTimeout(10000);

// After the error fired, is every visible image actually fine?
const imgs = await page.evaluate(() =>
  [...document.querySelectorAll("img")].map((im) => ({
    panel: im.closest(".panel")?.dataset?.panel ?? "(map/other)",
    ok: im.complete && im.naturalWidth > 0,
    hidden: im.closest(".panel")?.hidden ?? false,
    src: String(im.getAttribute("src") ?? "").slice(0, 40),
  })),
);
const broken = imgs.filter((i) => !i.ok);
console.log(`decode errors during this run: ${decodeErrs.length}`);
console.log(`total <img>: ${imgs.length}, broken (naturalWidth 0): ${broken.length}`);
for (const b of broken.slice(0, 10)) console.log("  BROKEN " + JSON.stringify(b));

// Are any panels showing an error state as a result?
const errored = await page.evaluate(() =>
  [...document.querySelectorAll('.panel[data-state="error"]')].map((p) => p.dataset.panel),
);
console.log(`panels in error state: ${errored.length ? errored.join(", ") : "(none)"}`);
await browser.close();
