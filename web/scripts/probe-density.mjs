// probe-density.mjs — count how many panels are visible without scrolling, and
// how much vertical space the live wall consumes. "Denser" is the goal, so it
// needs a number: measured, not eyeballed from a screenshot.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.click(".rail-btn:nth-child(1)");
await page.waitForTimeout(12_000);

const d = await page.evaluate(() => {
  const host = document.getElementById("panels");
  const hostRect = host.getBoundingClientRect();
  const panels = [...host.querySelectorAll(".panel[data-panel]")];
  const info = panels.map((p) => {
    const r = p.getBoundingClientRect();
    return {
      id: p.dataset.panel,
      h: Math.round(r.height),
      // fully within the visible column area?
      visible: r.top >= hostRect.top - 1 && r.bottom <= hostRect.bottom + 1,
      partial: r.top < hostRect.bottom && r.bottom > hostRect.top,
    };
  });
  const wall = host.querySelector(".wall");
  const wallPanel = host.querySelector('.panel[data-panel="live_streams"]');
  return {
    columnHeight: Math.round(hostRect.height),
    panelCount: panels.length,
    fullyVisible: info.filter((i) => i.visible).length,
    partiallyVisible: info.filter((i) => i.partial).length,
    scrollHeight: host.scrollHeight,
    wall: wall ? { tiles: wall.querySelectorAll(".cam").length, h: Math.round(wall.getBoundingClientRect().height) } : null,
    wallPanelH: wallPanel ? Math.round(wallPanel.getBoundingClientRect().height) : null,
    heights: info.map((i) => `${i.id}:${i.h}`),
  };
});
console.log(JSON.stringify(d, null, 2));
await browser.close();
