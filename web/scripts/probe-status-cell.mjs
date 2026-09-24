// probe-status-cell.mjs — read the COMPUTED flex properties of the status cell
// children, to see why .sl ends up 0 width.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(12000);

const info = await page.evaluate(() => {
  const cell = document.querySelector('.panel[data-panel="tp_queue_grid"] .status');
  if (!cell) return { missing: true };
  const cs = getComputedStyle(cell);
  const kids = [...cell.children].map((el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      cls: el.className,
      w: Math.round(r.width),
      text: (el.textContent ?? "").slice(0, 20),
      flex: `${s.flexGrow} ${s.flexShrink} ${s.flexBasis}`,
      minWidth: s.minWidth,
      whiteSpace: s.whiteSpace,
      display: s.display,
      overflow: s.overflow,
    };
  });
  return {
    cellW: Math.round(cell.getBoundingClientRect().width),
    cellDisplay: cs.display,
    cellGap: cs.gap,
    cellOverflow: cs.overflow,
    cellFlexWrap: cs.flexWrap,
    kids,
    cellsCount: document.querySelectorAll('.panel[data-panel="tp_queue_grid"] .status').length,
    gridCols: getComputedStyle(document.querySelector('.panel[data-panel="tp_queue_grid"] .statuses')).gridTemplateColumns,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
