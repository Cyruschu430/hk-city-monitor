// probe-wind-diag.mjs — why is the wind overlay holding zero layers?
//
// The field loads (352 samples) and the layer never moves. `__windField` proves
// the DATA arrived; `__windOverlay` (a QA hook in map/wind.ts) proves whether the
// deck overlay was given a layer at all. This prints both, plus the map
// container's real DOM, so the next guess is grounded.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const url = process.argv[2] ?? "http://localhost:4173/";
const browser = await chromium.launch({ executablePath: exe, headless: false });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, locale: "zh-HK" });
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text().slice(0, 180)}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${String(e).slice(0, 300)}`));

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  [...document.querySelectorAll("#rail .rail-btn")]
    .find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("風場"))?.click();
});
await page.waitForFunction(() => Boolean(window.__windField), null, { timeout: 60_000 }).catch(() => {});
await page.waitForTimeout(5000);

const out = await page.evaluate(() => ({
  hook: window.__windOverlay
    ? {
        deckCanvases: window.__windOverlay.deckCanvases(),
        layerCount: window.__windOverlay.layerCount(),
        visible: window.__windOverlay.visible(),
        hasParticle: window.__windOverlay.hasParticle(),
        zoom: window.__windOverlay.zoom(),
      }
    : "NO HOOK — build() never got this far",
  field: window.__windField ?? null,
  mapChildren: [...window.__map.getContainer().children].map(
    (c) => `${c.tagName}.${c.className || "(none)"} z=${getComputedStyle(c).zIndex} ${Math.round(c.getBoundingClientRect().width)}x${Math.round(c.getBoundingClientRect().height)}`,
  ),
  allCanvases: [...document.querySelectorAll("canvas")].map((c) => `${c.className || "(none)"} ${c.width}x${c.height}`),
  controls: (window.__map._controls ?? []).map((c) => ({
    ctor: c?.constructor?.name,
    setProps: typeof c?.setProps === "function",
    onAdd: typeof c?.onAdd === "function",
  })),
  railPressed: (() => {
    const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
      (x.querySelector(".tip")?.textContent ?? "").includes("風場"),
    );
    return b?.getAttribute("aria-pressed") ?? null;
  })(),
}));
console.log(JSON.stringify(out, null, 1));
console.log("--- console ---");
for (const l of logs.slice(0, 20)) console.log("  " + l);
await browser.close();
