// probe-uiux-review.mjs — capture the states a UI/UX review actually needs.
//
// The reviewer is a vision model, so the shots have to show the things that go
// wrong and that a DOM assertion cannot see: light vs dark (the map face is dark
// in both), the panel column's density, the ticker's classification, the LAYERS
// control legibility, the analysis-free overview after the panel withdrawals, and
// the water/border POI layers.
import { chromium } from "playwright-core";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:4173/";
const OUT = process.argv[3] ?? "C:/hk-city-monitor/web/test/artifacts/review";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });

const shoot = async (name, { theme, width = 1600, height = 1000, prepare } = {}) => {
  const page = await browser.newPage({ viewport: { width, height }, locale: "zh-HK" });
  if (theme) {
    await page.addInitScript((t) => {
      try {
        localStorage.setItem("hkcm.theme", t);
      } catch {}
    }, theme);
  }
  await page.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
  // Let every panel leave the loading state.
  await page
    .waitForFunction(
      () => {
        const ps = [...document.querySelectorAll(".panel[data-state]")];
        return ps.length > 0 && ps.every((p) => p.dataset.state !== "loading");
      },
      null,
      { timeout: 60_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(4000);
  if (prepare) {
    await prepare(page);
    await page.waitForTimeout(9000);
  }
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const state = await page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    mode: window.__hkcm?.currentMode?.() ?? null,
    panels: [...document.querySelectorAll(".panel[data-panel]")].filter(
      (p) => p.getBoundingClientRect().height > 0 && getComputedStyle(p).display !== "none",
    ).length,
    columnScreens: (() => {
      const c = document.querySelector("#panels");
      return c ? +(c.scrollHeight / c.clientHeight).toFixed(2) : null;
    })(),
  }));
  console.log(`${name.padEnd(26)} ${JSON.stringify(state)}`);
  await page.close();
};

const railClick = async (page, needle) => {
  await page.evaluate((n) => {
    const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
      (x.querySelector(".tip")?.textContent ?? "").includes(n),
    );
    b?.click();
  }, needle);
};

// 1. Overview, dark (the default first impression).
await shoot("01-overview-dark", { theme: "dark" });
// 2. Overview, LIGHT — the theme where the map-face text was invisible.
await shoot("02-overview-light", { theme: "light" });
// 3. The whole panel column in one tall shot, so density/raggedness is visible.
const colPage = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await colPage.addInitScript(() => {
  try {
    localStorage.setItem("hkcm.theme", "dark");
  } catch {}
});
await colPage.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
await colPage.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await colPage.waitForTimeout(22000);
const col = await colPage.$("#panelCol");
if (col) await col.screenshot({ path: `${OUT}/03-panel-column.png` });
console.log("03-panel-column            (full column)");
await colPage.close();

// 4. Water mode — the geocoded pins over the district tint.
await shoot("04-water-pins", {
  theme: "dark",
  prepare: (p) => railClick(p, "停水"),
});
// 5. Border mode — the control-point POIs.
await shoot("05-border-pois", {
  theme: "dark",
  prepare: (p) => railClick(p, "口岸"),
});
// 6. Typhoon mode — the raster/image panels.
await shoot("06-typhoon", {
  theme: "dark",
  prepare: (p) => railClick(p, "颱風"),
});
// 7. Mobile-ish width, to catch a layout that only breaks narrow.
await shoot("07-narrow", { theme: "dark", width: 900, height: 1000 });
// 8. The ticker strip alone, zoomed, to judge the category tags.
const tickPage = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK", deviceScaleFactor: 2 });
await tickPage.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
await tickPage.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await tickPage.waitForTimeout(20000);
const tick = await tickPage.$("#ticker");
if (tick) await tick.screenshot({ path: `${OUT}/08-ticker.png` });
console.log("08-ticker                  (strip, 2x)");
// 9. The LAYERS control alone, 2x, for legibility judgement.
const lyr = await tickPage.$(".layer-control");
if (lyr) await lyr.screenshot({ path: `${OUT}/09-layers-control.png` });
console.log("09-layers-control          (2x)");
await tickPage.close();

await browser.close();
