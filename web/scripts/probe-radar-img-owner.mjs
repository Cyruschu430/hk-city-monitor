// probe-radar-img-owner.mjs — a 404 radar URL is still being fetched as an image.
// Name the element/panel that owns it.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });

// Tag every <img> with its owning panel as it is inserted.
await page.addInitScript(() => {
  window.__radarReqs = [];
  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const imgs = n.tagName === "IMG" ? [n] : [...n.querySelectorAll?.("img") ?? []];
        for (const im of imgs) {
          const panel = im.closest?.(".panel")?.dataset?.panel ?? "(no panel)";
          const src = String(im.getAttribute("src") ?? "");
          if (src.includes("radar") || src.startsWith("data:")) {
            window.__radarReqs.push({ panel, kind: src.startsWith("data:") ? "DATA-URL" : src.slice(-40) });
          }
        }
      }
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
});

const imgReqs = [];
page.on("request", (r) => {
  if (r.resourceType() === "image" && r.url().includes("radar")) imgReqs.push(r.url().slice(-42));
});

await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(12000);
await page.evaluate(() => { window.__radarReqs.length = 0; });
imgReqs.length = 0;

await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("颱風"));
  b?.click();
});
await page.waitForTimeout(10000);

const tags = await page.evaluate(() => window.__radarReqs ?? []);
console.log(`img elements touching radar: ${tags.length}`);
for (const t of tags) console.log("  " + JSON.stringify(t));
console.log(`\nnetwork image requests containing "radar": ${imgReqs.length}`);
for (const u of imgReqs) console.log("  " + u);
await browser.close();
