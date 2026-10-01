// check-shell.mjs — the page shell, asserted in the DOM.
//
// Every assertion here is a decision someone made about the chrome, and each one is the kind a
// screenshot review would get wrong: whether an element is BELOW another, whether a dot is gone,
// whether a cell was never appended. Cyrus 2026-10-02 asked for all of these in one message, and
// AGENTS.md is explicit that a UI claim is verified in the DOM rather than from a picture.
//
//   node scripts/check-shell.mjs        # against the preview server on :4173
import { chromium } from "playwright-core";

const exe = process.env.CHROME_PATH ?? process.env.HKCM_CHROME
  ?? "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const BASE = process.env.HKCM_URL ?? process.env.BASE ?? "http://localhost:4173/";
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? "OK  " : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
try { await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 }); }
catch { console.log("FAIL  the app never booted"); await browser.close(); process.exit(1); }
await page.waitForTimeout(3000);

const r = await page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, left: b.left, cy: b.top + b.height / 2 };
  };
  const statFresh = document.querySelector("#statusbar .stat-fresh");
  const gh = document.querySelector(".gh-btn");
  const icon = document.querySelector(".brand-icon");
  const gauges = document.querySelectorAll(".gauges").length;
  return {
    livePulse: document.querySelectorAll(".live-pulse").length,
    // The freshness cell is still BUILT but must not be appended: a cell whose label is hidden at
    // this width rendered as a bare "1 stale", which is a number with no noun.
    freshCellInHeader: !!statFresh && !!document.getElementById("statusbar")?.contains(statFresh),
    ghHref: gh?.getAttribute("href") ?? null,
    iconSrc: icon?.getAttribute("src") ?? null,
    foot: box(".app-foot"), mapWrap: box("#mapWrap"), panelCol: box("#panelCol"),
    scope: box(".mh-scope"), clock: box(".mh-clock"),
    gauges,
    legendItems: document.querySelectorAll(".gauges .legend-i").length,
  };
});
await browser.close();

ok(r.livePulse === 0, "the brand dot is gone");
ok(!r.freshCellInHeader, "the freshness cell is not in the header (nothing reads as a bare \"1 stale\")");
ok(r.iconSrc === "/icon-192.png", `the app icon is beside the name (src=${r.iconSrc})`);
ok(r.ghHref === "https://github.com/Cyruschu430/hk-city-monitor", `the GitHub button targets the repo (${r.ghHref})`);
if (r.foot && r.mapWrap && r.panelCol) {
  ok(r.foot.top >= r.mapWrap.bottom - 2, `the footer is below the map (foot ${Math.round(r.foot.top)} vs map bottom ${Math.round(r.mapWrap.bottom)})`);
  ok(r.foot.top >= r.panelCol.bottom - 2, `the footer is below the panel column (foot ${Math.round(r.foot.top)} vs panels bottom ${Math.round(r.panelCol.bottom)})`);
} else {
  ok(false, "the footer, the map and the panel column are all present");
}
if (r.scope && r.clock) {
  ok(Math.abs(r.scope.cy - r.clock.cy) < 12, `the clock shares the placard's baseline (Δ${Math.round(Math.abs(r.scope.cy - r.clock.cy))}px)`);
  ok(r.clock.left > r.scope.left, "the clock sits after 香港實時情況, not before it");
} else {
  ok(false, "the map placard has both scope and clock");
}
// The gauge panel is source-backed, so only assert the key if the panel actually drew one.
if (r.gauges > 0) ok(r.legendItems >= 5, `the AQHI key drew its bands (${r.legendItems} entries)`);
else console.log("note  no gauge panel rendered in this run - legend not asserted");

console.log(fails.length ? `SHELL: ${fails.length} FAILED` : "SHELL OK");
process.exit(fails.length ? 1 : 0);
