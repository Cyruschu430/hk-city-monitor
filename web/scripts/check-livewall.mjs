// check-livewall.mjs — the live wall's region tabs, exercised by clicking them.
//
// The numbers are the evidence: deep-review.mjs already screenshots the page, and a PNG
// would churn ~850KB in git on every run.
import { chromium } from "playwright-core";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });
const errs = [], bad = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
page.on("requestfailed", (r) => bad.push(r.url().slice(0, 120)));
page.on("response", (r) => { if (r.status() >= 400) bad.push(`HTTP ${r.status()} ${r.url().slice(0, 110)}`); });

await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
try { await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 }); } catch {}
await page.waitForTimeout(18000);

const read = () => page.evaluate(() => {
  const p = document.querySelector('[data-panel="live_wall"]');
  if (!p) return { found: false };
  return {
    found: true,
    title: p.querySelector(".panel-head h2")?.textContent?.slice(0, 24) ?? "",
    tabs: [...p.querySelectorAll(".walltabs .ptab")].map((b) => b.textContent.replace(/\s+/g, " ").trim()),
    active: p.querySelector('.walltabs .ptab[aria-selected="true"]')?.getAttribute("data-region"),
    tiles: p.querySelectorAll(".wall .cam").length,
    liveTiles: p.querySelectorAll(".wall .cam.live").length,
    labels: [...p.querySelectorAll(".wall .lab")].map((l) => l.textContent.split(" · ")[0].slice(0, 20)),
  };
});

const r = { initial: await read() };

// Click each region tab in turn and record what the wall becomes. Without this the test
// would only prove the strip renders, not that picking a region does anything.
const regions = await page.evaluate(() =>
  [...document.querySelectorAll('[data-panel="live_wall"] .walltabs .ptab')].map((b) => b.getAttribute("data-region")),
);
r.byRegion = {};
for (const key of regions) {
  if (key === "") continue;
  await page.click(`[data-panel="live_wall"] .walltabs .ptab[data-region="${key}"]`);
  await page.waitForTimeout(2600);
  r.byRegion[key] = await read();
}
await page.click('[data-panel="live_wall"] .walltabs .ptab[data-region=""]');
await page.waitForTimeout(2600);
r.backToAll = await read();

r.mainTabs = await page.evaluate(() =>
  [...document.querySelectorAll(".ptab")].filter((b) => !b.closest(".walltabs")).map((b) => b.textContent.replace(/\s+/g, " ").trim()),
);
r.panelCount = await page.evaluate(() => document.querySelectorAll("[data-panel]").length);
console.log(JSON.stringify(r, null, 1));
console.log("\nconsole errors:", errs.length ? [...new Set(errs)].slice(0, 4) : "0");
console.log("failed/4xx:", [...new Set(bad)].slice(0, 6));
await browser.close();
