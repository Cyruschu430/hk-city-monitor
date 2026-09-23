// probe-water-districts.mjs — the drawn districts do not match the active set.
// Harness: 來源18區=13 畫出=葵青區、沙田區、九龍城區、灣仔區、中西區、東區
//          標紅區=九龍城區、荃灣區、北區、東區、灣仔區、中西區、葵青區、沙田區
// 荃灣區 and 北區 are active but NOT drawn.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, locale: "zh-HK" });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(10000);

await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
    (x.querySelector(".tip")?.textContent ?? "").includes("停水模式"));
  b?.click();
});
await page.waitForTimeout(12000);

const out = await page.evaluate(() => {
  const map = window.__map;
  const fillId = "vl-water_suspension_districts-fill";
  const active = window.__hkcm.activeDistricts();

  // What the source actually carries.
  const srcFeats = map.querySourceFeatures("vl-water_suspension_districts");
  const srcNames = [...new Set(srcFeats.map((f) => f.properties?.DISTRICT_CHINESE))].filter(Boolean);

  // What the layer filter says should be drawn.
  const filter = map.getFilter(fillId);
  const filterNames = JSON.stringify(filter).match(/"[^"]*區"/g)?.map((s) => s.slice(1, -1)) ?? [];

  // What is ACTUALLY rendered right now.
  const rendered = map.queryRenderedFeatures({ layers: [fillId] });
  const renderedNames = [...new Set(rendered.map((f) => f.properties?.DISTRICT_CHINESE))].filter(Boolean);

  return {
    active,
    srcCount: srcNames.length,
    srcNames,
    filterNames,
    renderedNames,
    // Active districts missing from each stage
    activeNotInSource: active.filter((a) => !srcNames.includes(a)),
    activeNotInFilter: active.filter((a) => !filterNames.includes(a)),
    activeNotRendered: active.filter((a) => !renderedNames.includes(a)),
    paintColor: JSON.stringify(map.getPaintProperty(fillId, "fill-color")).slice(0, 200),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
