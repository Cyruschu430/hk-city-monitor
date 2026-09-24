// probe-image-decode.mjs — find WHICH image throws InvalidStateError, and whether
// it is a dead camera, a truncated response, or a format the browser refuses.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });

const errs = [];
page.on("pageerror", (e) => errs.push({ kind: "pageerror", msg: e.message.slice(0, 200), stack: (e.stack ?? "").split("\n").slice(0, 4).join(" | ") }));
page.on("console", (m) => {
  if (m.type() === "error") errs.push({ kind: "console", msg: m.text().slice(0, 200) });
});

// Track image responses: status, content-type, byte length.
const imgs = [];
page.on("response", async (r) => {
  const ct = r.headers()["content-type"] ?? "";
  if (ct.startsWith("image/") || /\.(jpg|jpeg|png|webp)(\?|$)/i.test(r.url())) {
    let len = r.headers()["content-length"];
    imgs.push({ status: r.status(), ct: ct.slice(0, 30), len: len ?? "?", url: decodeURIComponent(r.url()).slice(-70) });
  }
});

await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(20000);

console.log("=== page errors ===");
for (const e of errs) console.log(JSON.stringify(e));

console.log(`\n=== image responses: ${imgs.length} ===`);
const byStatus = imgs.reduce((m, i) => ((m[i.status] = (m[i.status] ?? 0) + 1), m), {});
console.log("status tally:", JSON.stringify(byStatus));
const bad = imgs.filter((i) => i.status !== 200);
console.log(`non-200 images (${bad.length}):`);
for (const b of bad.slice(0, 10)) console.log(`  ${b.status} ${b.ct} ${b.len}b  ${b.url}`);

// Which <img> elements are actually broken in the DOM?
const broken = await page.evaluate(() =>
  [...document.querySelectorAll("img")]
    .map((im) => ({
      src: im.currentSrc || im.src,
      complete: im.complete,
      naturalW: im.naturalWidth,
      naturalH: im.naturalHeight,
      dead: im.closest(".cam")?.classList.contains("dead") ?? false,
    }))
    .filter((x) => x.complete && x.naturalWidth === 0)
    .map((x) => ({ ...x, src: x.src.slice(-70) })),
);
console.log(`\n=== <img> with naturalWidth 0 (${broken.length}) ===`);
for (const b of broken.slice(0, 12)) console.log(`  dead=${b.dead} ${b.src}`);
await browser.close();
