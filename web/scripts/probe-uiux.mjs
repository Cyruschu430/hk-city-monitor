// probe-uiux.mjs — measure the layout against the World Monitor reference.
// A visual comparison needs numbers before opinions: what is on screen, how
// much space each region takes, what font sizes and weights are actually
// applied, and how dense the panel column is. Prints a table; asserts nothing.
import { chromium } from "playwright-core";

const URL_UNDER_TEST = process.argv[2] ?? "https://hk-city-monitor.pages.dev/";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await page.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page
  .waitForFunction(
    () => {
      const ps = [...document.querySelectorAll(".panel[data-state]")];
      return ps.length >= 17 && ps.every((p) => p.dataset.state !== "loading");
    },
    null,
    { timeout: 90_000 },
  )
  .catch(() => {});
await page.waitForTimeout(3000);

const m = await page.evaluate(() => {
  const r = (el) => (el ? el.getBoundingClientRect() : null);
  const px = (v) => Math.round(v * 10) / 10;
  const rect = (el) => {
    const b = r(el);
    return b ? { x: px(b.x), y: px(b.y), w: px(b.width), h: px(b.height) } : null;
  };
  const cs = (el, props) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const out = {};
    for (const p of props) out[p] = s.getPropertyValue(p);
    return out;
  };

  const doc = document.documentElement;
  const panelsRoot = document.querySelector("#panels");
  const map = document.querySelector("#map");
  const rail = document.querySelector("#rail");
  const statusbar = document.querySelector("#statusbar");
  const ticker = document.querySelector("#ticker");
  const drawer = document.querySelector("#drawer");

  // Region budget: how much of the viewport each area owns.
  const regions = [
    ["statusbar", statusbar],
    ["ticker", ticker],
    ["map", map],
    ["rail", rail],
    ["panels", panelsRoot],
    ["drawer", drawer],
  ].map(([name, el]) => ({ name, rect: rect(el) }));

  // Panel column anatomy.
  const panels = [...document.querySelectorAll(".panel[data-panel]")];
  const panelRects = panels.map((p) => rect(p));
  const colWidths = [...new Set(panelRects.map((b) => (b ? Math.round(b.w) : 0)))];
  const colLefts = [...new Set(panelRects.map((b) => (b ? Math.round(b.x) : 0)))].sort((a, b) => a - b);

  // Typography actually applied.
  const titleEl = panels[0]?.querySelector(".p-title") ?? panels[0]?.querySelector("h3");
  const panelTitle = cs(titleEl, ["font-size", "font-weight", "letter-spacing", "text-transform"]);
  const statusLabel = cs(document.querySelector(".status .sl"), ["font-size", "font-weight", "text-transform"]);
  const chip = cs(document.querySelector(".chip"), ["font-size", "font-weight", "border-radius", "padding"]);

  // Map chrome: does a legend exist, and how tall is it?
  const legend = document.querySelector(".layer-ctl, #layerCtl, .layers, .legend");
  const maphead = document.querySelector("#mapHead");
  const badge = document.querySelector(".landsd-badge");

  // Counts.
  const counts = {
    panels: panels.length,
    tabs: document.querySelectorAll("#panelTabs .ptab").length,
    railButtons: document.querySelectorAll("#rail .rail-btn").length,
    statusCells: document.querySelectorAll(".statuses .status").length,
    legendRows: document.querySelectorAll(".layer-ctl .lyr, .lyr-row, .layer-row").length,
  };

  return {
    viewport: { w: doc.clientWidth, h: doc.clientHeight },
    scroll: { w: doc.scrollWidth, h: doc.scrollHeight },
    regions,
    panelColumn: { widthVariants: colWidths, leftVariants: colLefts, count: panels.length },
    typography: { panelTitle, statusLabel, chip },
    mapChrome: {
      legend: rect(legend),
      legendRows: counts.legendRows,
      mapHead: rect(maphead),
      landsdBadge: rect(badge),
      mapHeadText: maphead?.textContent?.trim().slice(0, 60) ?? null,
    },
    counts,
  };
});

console.log(JSON.stringify(m, null, 2));

// Density: information per vertical pixel in the panel column.
const density = await page.evaluate(() => {
  const panels = [...document.querySelectorAll(".panel[data-panel]")];
  let items = 0;
  for (const p of panels) items += p.querySelectorAll("li, tr").length;
  const col = document.querySelector("#panels");
  return { listItems: items, columnHeight: Math.round(col?.scrollHeight ?? 0), panels: panels.length };
});
console.log("\nDENSITY:", JSON.stringify(density));

await browser.close();
