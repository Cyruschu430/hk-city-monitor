// probe-p0.mjs — verify the WORK_ORDER P0 claims in the DOM, not by reading code.
// AGENTS.md: "A claim about the UI is verified in the DOM, not from a screenshot."
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, locale: "zh-HK" });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(9000);

const out = await page.evaluate(() => {
  const hk = window.__hkcm;
  const map = window.__map;

  // P0-2: do any two rail layer buttons share the SAME icon path?
  // A fallback to ICONS.overview means several buttons render identically.
  const layerBtns = [...document.querySelectorAll("#rail .rail-btn")].filter((b) => b.querySelector(".tip"));
  const icons = layerBtns.map((b) => {
    const svg = b.querySelector("svg");
    const paths = [...(svg?.querySelectorAll("path") ?? [])].map((p) => p.getAttribute("d")).join("|");
    return { tip: b.querySelector(".tip")?.textContent ?? "", paths, pressed: b.getAttribute("aria-pressed") };
  });
  // The overview mode icon — anything equal to it is a silent fallback.
  const overviewBtn = [...document.querySelectorAll("#rail .rail-btn")].find((b) =>
    (b.querySelector(".tip")?.textContent ?? "").includes("總覽"));
  const overviewPaths = [...(overviewBtn?.querySelectorAll("path") ?? [])].map((p) => p.getAttribute("d")).join("|");

  return {
    railLayers: icons,
    overviewPaths,
    // Which rail layers are duplicated or equal to the overview fallback?
    fallbackToOverview: icons.filter((i) => i.paths === overviewPaths).map((i) => i.tip),
    // layer controls
    layersOn: hk?.layersOn ? hk.layersOn() : "no hook",
    layerDefaults: hk?.layerDefaults ? hk.layerDefaults() : "no hook",
    drawnLayers: hk?.drawnLayers ? hk.drawnLayers() : null,
    // P0-1: freshness text
    freshness: document.querySelector(".stat-fresh .stat-value")?.textContent?.trim(),
    coverage: document.querySelector(".cover-text")?.textContent?.trim(),
    // layer control panel present?
    layerControl: (() => {
      const el = document.querySelector(".layer-control");
      if (!el) return "MISSING";
      return { hidden: el.hidden, rows: el.querySelectorAll(".lyr-label").length };
    })(),
    panelTabs: hk?.tabs ? hk.tabs() : "no hook",
    overviewCount: hk?.overviewIds ? hk.overviewIds().length : null,
    mapLayers: (map?.getStyle()?.layers ?? []).map((l) => l.id).filter((i) => i.startsWith("vl-") || i.startsWith("cameras-")),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
