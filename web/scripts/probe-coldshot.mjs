// probe-coldshot.mjs — capture the TRUE first paint: no clicks, no layer
// toggles, nothing but a load. The verify harness's screenshots are taken after
// it has clicked through every mode and toggled layers, so they show a state no
// real first-time visitor ever sees. This is the honest "what does a new user
// get" image.
import { chromium } from "playwright-core";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:4173/";
const out = process.argv[3] ?? "cold-boot.png";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await page.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
// Let every panel settle, but touch nothing.
await page
  .waitForFunction(
    () => {
      const ps = [...document.querySelectorAll(".panel[data-state]")];
      return ps.length >= 18 && ps.every((p) => p.dataset.state !== "loading");
    },
    null,
    { timeout: 90_000 },
  )
  .catch(() => {});
await page.waitForTimeout(3000);

const state = await page.evaluate(() => ({
  mode: window.__hkcm?.currentMode?.() ?? null,
  mounted: document.querySelectorAll(".panel[data-panel]").length,
  layersOn: window.__hkcm?.layersOn?.() ?? [],
  activeDistricts: window.__hkcm?.activeDistricts?.() ?? [],
  waterLayerDrawn: !!window.__map?.getLayer("vl-water_suspension_districts-fill"),
  drawerOpen: !document.querySelector("#drawer")?.hasAttribute("hidden"),
  hiddenPanels: window.__hkcm?.hiddenPanels?.() ?? [],
}));
console.log(JSON.stringify(state, null, 2));

await page.screenshot({ path: out, fullPage: false });
console.log(`screenshot → ${out}`);
await browser.close();
