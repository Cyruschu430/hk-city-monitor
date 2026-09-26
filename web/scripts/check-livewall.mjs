// check-livewall.mjs — does the new panel actually render live tiles?
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

const r = await page.evaluate(() => {
  const dump = (id) => {
    const p = document.querySelector(`[data-panel="${id}"]`);
    if (!p) return { id, found: false };
    return {
      id, found: true,
      title: p.querySelector(".panel-head h2")?.textContent?.slice(0, 30) ?? "",
      tiles: p.querySelectorAll(".wall .cam").length,
      liveTiles: p.querySelectorAll(".wall .cam.live").length,
      liveBadges: [...p.querySelectorAll(".chip.live")].filter(b => b.textContent.includes("LIVE")).length,
      notLiveBadges: [...p.querySelectorAll(".chip")].filter(b => b.textContent.includes("無直播")).length,
      offscreen: Math.round(p.getBoundingClientRect().height) > 0 && p.getBoundingClientRect().height < 40,
      labels: [...p.querySelectorAll(".wall .lab")].map(l => l.textContent.slice(0, 26)),
    };
  };
  return {
    world: dump("world_news_wall"),
    cams: dump("live_cams_wall"),
    totalPanels: document.querySelectorAll("[data-panel]").length,
    groupTabs: [...document.querySelectorAll(".ptab")].map(b => b.textContent.replace(/\s+/g, " ").trim()).slice(0, 14),
    newTab: (() => { const b = [...document.querySelectorAll(".ptab")].find(x => x.textContent.includes("新聞")); return b ? b.textContent.replace(/\s+/g," ").trim() : null; })(),
    bodyH: document.body.scrollHeight,
  };
});

// No screenshot: deep-review.mjs already captures the same page, and this project's own rule is
// that the numbers are the evidence and the image is context. A second PNG would also churn
// ~850KB in git on every run.
console.log(JSON.stringify(r, null, 2));
console.log("\nconsole errors:", errs.length ? errs.slice(0, 5) : "0");
console.log("failed/4xx:", [...new Set(bad)].slice(0, 6));
await browser.close();
