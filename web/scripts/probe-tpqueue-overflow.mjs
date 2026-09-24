// probe-tpqueue-overflow.mjs — tp_queue_grid has inner overflow. Find out what
// is wider than its box, and by how much.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(12000);

const info = await page.evaluate(() => {
  const p = document.querySelector('.panel[data-panel="tp_queue_grid"]');
  if (!p) return { missing: true };
  const box = p.getBoundingClientRect();
  const wide = [...p.querySelectorAll("*")]
    .map((el) => ({ tag: el.tagName, cls: el.className, sw: el.scrollWidth, cw: el.clientWidth, w: Math.round(el.getBoundingClientRect().width) }))
    .filter((e) => e.sw > e.cw + 2)
    .slice(0, 10);
  const grids = [...p.querySelectorAll(".statuses, .status")].map((el) => ({
    cls: el.className,
    w: Math.round(el.getBoundingClientRect().width),
    sw: el.scrollWidth,
  }));
  return {
    panelW: Math.round(box.width),
    panelScrollW: p.scrollWidth,
    panelClientW: p.clientWidth,
    overflowEls: wide,
    grids: grids.slice(0, 8),
    gridTemplate: (() => {
      const g = p.querySelector(".statuses");
      return g ? getComputedStyle(g).gridTemplateColumns : null;
    })(),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
