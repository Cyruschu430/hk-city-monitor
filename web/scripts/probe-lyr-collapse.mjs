// probe-lyr-collapse.mjs — does the LAYERS list actually collapse and stay
// collapsed across the rebuild a mode switch triggers?
//
// The risk this exists for: `setRows()` rebuilds the control from scratch on
// every mode switch (`paintLegend` is its only caller), so a collapse flag kept
// only in the DOM would silently re-open the list the moment the user changed
// mode. The flag therefore lives in module state and is painted by `build()`.
// This probe reads the REAL control after a REAL mode crossing — not a hook.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const url = process.argv[2] ?? "http://localhost:4173/";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, locale: "zh-HK" });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
// Wait for a predicate, not a timer (Pitfall 19): the control must have rows.
await page.waitForFunction(
  () => (document.querySelector(".layer-control")?.querySelectorAll(".lyr-row").length ?? 0) > 0,
  null,
  { timeout: 45_000 },
);
await page.waitForTimeout(2500);

const snap = () =>
  page.evaluate(() => {
    const el = document.querySelector(".layer-control");
    const head = el?.querySelector(".lyr-head");
    const body = el?.querySelector(".lyr-body");
    const r = body?.getBoundingClientRect();
    return {
      tag: head?.tagName.toLowerCase(),
      ariaExpanded: head?.getAttribute("aria-expanded"),
      ariaControls: head?.getAttribute("aria-controls"),
      controlsResolves: !!(head?.getAttribute("aria-controls") &&
        document.getElementById(head.getAttribute("aria-controls"))),
      bodyH: r ? Math.round(r.height) : null,
      headH: Math.round(head?.getBoundingClientRect().height ?? 0),
      rows: el?.querySelectorAll(".lyr-row").length,
      count: el?.querySelector(".lyr-count")?.textContent,
      chev: getComputedStyle(el.querySelector(".lyr-chev")).transform,
      stored: localStorage.getItem("hkcm.lyrCollapsed"),
      classCollapsed: el.classList.contains("collapsed"),
    };
  });

console.log("expanded   :", JSON.stringify(await snap()));

const click = () => page.evaluate(() => document.querySelector(".layer-control .lyr-head").click());
await click();
await page.waitForTimeout(400);
console.log("collapsed  :", JSON.stringify(await snap()));

// Rows must be genuinely unpainted AND unclickable — a transparent-but-present
// row would still swallow map clicks.
const hit = await page.evaluate(() => {
  const row = document.querySelector(".layer-control .lyr-row");
  if (!row) return { err: "no row" };
  const r = row.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { rectH: Math.round(r.height), topEl: top?.className ?? String(top?.tagName) };
});
console.log("row hit test:", JSON.stringify(hit));

// Cross a mode boundary and come back — the rebuild is the whole point.
await page.evaluate(() => {
  [...document.querySelectorAll("#rail .rail-btn")]
    .find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("颱風"))?.click();
});
await page.waitForTimeout(7000);
console.log("typhoon    :", JSON.stringify(await snap()));
await page.evaluate(() => {
  [...document.querySelectorAll("#rail .rail-btn")]
    .find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("總覽"))?.click();
});
await page.waitForTimeout(7000);
console.log("back       :", JSON.stringify(await snap()));

// Re-open, and confirm the glyphs still drew on the rebuilt content.
await click();
await page.waitForTimeout(600);
console.log("reopened   :", JSON.stringify(await snap()));
const glyphs = await page.evaluate(() =>
  [...document.querySelectorAll(".layer-control canvas.lyr-glyph")].map((c) => {
    const d = c.getContext("2d").getImageData(0, 0, 14, 14).data;
    let ink = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) ink++;
    return ink;
  }),
);
console.log("glyph ink  :", JSON.stringify(glyphs));

await browser.close();
