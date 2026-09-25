// probe-symbology.mjs — are the suspension pins and the border control points
// drawn as SYMBOLS, and does every LAYERS row carry a visible mark?
//
// Cyrus 2026-09-25: "Suspension Location layer and Border control point layer -
// use relevant symbology for them, don't use simple point symbols" and "LAYERS
// Legend panel in the map view (should make it expandable)".
//
// Two silent failure modes this has to catch, because neither throws:
//   · an `icon-image` naming an image that was never registered — MapLibre draws
//     NOTHING and reports nothing;
//   · a legend glyph whose id is not in GLYPHS — `drawGlyphInto` returns early and
//     leaves a transparent canvas (measured: the control-point row did exactly
//     that for as long as `symbol: "poi"` was in layers.json).
// So both are asserted by reading back the actual icon bytes, not the config.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const url = process.argv[2] ?? "http://localhost:4173/";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, locale: "zh-HK" });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(4000);

const mode = async (label) => {
  await page.evaluate((needle) => {
    [...document.querySelectorAll("#rail .rail-btn")]
      .find((x) => (x.querySelector(".tip")?.textContent ?? "").includes(needle))?.click();
  }, label);
  await page.waitForTimeout(8000);
};

/** Ink pixels in a legend canvas — 0 means the glyph never drew. */
const legend = () =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll(".layer-control .lyr-item")];
    return rows.map((item) => {
      const cv = item.querySelector("canvas.lyr-glyph");
      const sw = item.querySelector(".lyr-swatch");
      let ink = null;
      if (cv) {
        const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
        ink = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) ink++;
      }
      return {
        label: item.querySelector(".lyr-label")?.textContent?.trim() ?? "",
        glyph: cv ? cv.className.replace("lyr-glyph ", "") : null,
        ink,
        swatch: sw ? sw.className.replace("lyr-swatch ", "") : null,
        swatchBg: sw ? getComputedStyle(sw).backgroundColor : null,
      };
    });
  });

/** How a map layer is drawn, plus whether its icons really exist. */
const mapLayer = (id) =>
  page.evaluate((layerId) => {
    const m = window.__map;
    const l = m.getLayer(layerId);
    if (!l) return { exists: false };
    const icon = l.layout?.["icon-image"];
    const names = typeof icon === "string" ? [icon] : Array.isArray(icon) ? icon.filter((x) => typeof x === "string") : [];
    return {
      exists: true,
      type: l.type,
      iconImage: JSON.stringify(icon ?? null),
      imagesPresent: Object.fromEntries(names.map((n) => [n, m.hasImage(n)])),
      rendered: m.queryRenderedFeatures({ layers: [layerId] }).length,
    };
  }, id);

console.log("== glyph images registered on the map ==");
console.log(
  JSON.stringify(
    await page.evaluate(() =>
      ["cp-land", "cp-sea", "cp-air", "no-water", "no-water-salt", "wind-flow", "blocks", "aerial"].map((n) => [
        n,
        window.__map.hasImage(n),
      ]),
    ),
  ),
);

console.log("\n== 口岸模式 ==");
await mode("口岸模式");
console.log("control point layer :", JSON.stringify(await mapLayer("vl-control_points")));
console.log("legend rows         :", JSON.stringify(await legend(), null, 1));

console.log("\n== 停水模式 ==");
await mode("停水模式");
console.log("water pins layer    :", JSON.stringify(await mapLayer("vl-water_suspension_districts-points")));
console.log("legend rows         :", JSON.stringify(await legend(), null, 1));

console.log("\n== 總覽（rail rows only） ==");
await mode("總覽");
console.log("legend rows         :", JSON.stringify(await legend(), null, 1));

console.log("\n== orphan check: 口岸嘅 bare layer 有冇清走 ==");
await mode("口岸模式");
await mode("總覽");
console.log(
  "vl- layers left     :",
  JSON.stringify(await page.evaluate(() => window.__map.getStyle().layers.map((l) => l.id).filter((i) => i.startsWith("vl-")))),
);

await browser.close();
