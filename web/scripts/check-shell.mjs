// check-shell.mjs — the page shell, asserted in the DOM.
//
// Every assertion here is a decision someone made about the chrome, and each one is the kind a
// screenshot review would get wrong: whether an element is BELOW another, whether a dot is gone,
// whether a cell was never appended. All of these were requested in one message, and
// A UI claim is verified in the DOM, not from a picture.
//
//   node scripts/check-shell.mjs        # against the preview server on :4173
import { chromium } from "playwright-core";

const exe = process.env.CHROME_PATH ?? process.env.HKCM_CHROME
  ?? "C:\\Users\\<user>\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
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
    badge: box(".landsd-badge"), attr: box(".maplibregl-ctrl-bottom-right"),
    gauges,
    legendItems: document.querySelectorAll(".gauges .legend-i").length,
    // 2026-10-02: no SOURCE link may take the reader off the dashboard. A row's href is the
    // publisher's URL and a click used to leave for a raw file; the URL now lives in the tooltip.
    // The deliberate destinations (GitHub, the licence, the LandsD badge) are excluded by name.
    navSourceLinks: document.querySelectorAll(
      '.plist a[target="_blank"], .panel .src[target="_blank"], .lyr-note a[target="_blank"]').length,
    srcHold: document.querySelectorAll(".src-hold").length,
    // Reader search (2026-10-02): the MTR and KMB panels declare params.search, so exactly
    // those two must carry a box. A box with nothing behind it would be a lie in the other direction.
    searchBoxes: document.querySelectorAll(".panel-head input[type=search]").length,
    searchPanels: [...document.querySelectorAll(".panel-head input[type=search]")].map(
      (el) => el.closest(".panel")?.getAttribute("data-panel") ?? "?").sort().join(","),
  };
});
await browser.close();

ok(r.livePulse === 0, "the brand dot is gone");
ok(!r.freshCellInHeader, "the freshness cell is not in the header (nothing reads as a bare \"1 stale\")");
ok(r.iconSrc === null, `the app icon is gone — the name stands alone (2026-10-03; src=${r.iconSrc})`);
ok(r.ghHref === null, `the header GitHub button is gone — the footer carries the repo (${r.ghHref})`);
if (r.foot && r.mapWrap && r.panelCol) {
  ok(r.foot.top >= r.mapWrap.bottom - 2, `the footer is below the map (foot ${Math.round(r.foot.top)} vs map bottom ${Math.round(r.mapWrap.bottom)})`);
  ok(r.foot.top >= r.panelCol.bottom - 2, `the footer is below the panel column (foot ${Math.round(r.foot.top)} vs panels bottom ${Math.round(r.panelCol.bottom)})`);
} else {
  ok(false, "the footer, the map and the panel column are all present");
}
if (r.scope && r.clock) {
  // 2026-10-02: the clock moved UNDER the placard, so the assertion is the new geometry -
  // below it, and starting at the same left edge - not the baseline they shared before.
    ok(r.badge && r.attr && r.badge.bottom <= r.attr.top + 2,
    `the LandsD attribution sits above MapLibre's own line (badge bottom ${r.badge && Math.round(r.badge.bottom)} vs attribution top ${r.attr && Math.round(r.attr.top)})`);
ok(r.clock.top >= r.scope.bottom - 2,
    `the clock sits under 香港實時情況 (clock top ${Math.round(r.clock.top)} vs scope bottom ${Math.round(r.scope.bottom)})`);
  ok(Math.abs(r.clock.left - r.scope.left) < 14, `both start at the same left edge (Δ${Math.round(Math.abs(r.clock.left - r.scope.left))}px)`);
} else {
  ok(false, "the map placard has both scope and clock");
}
// The gauge panel is source-backed, so only assert the key if the panel actually drew one.
if (r.gauges > 0) ok(r.legendItems >= 5, `the AQHI key drew its bands (${r.legendItems} entries)`);
else console.log("note  no gauge panel rendered in this run - legend not asserted");

ok(r.navSourceLinks === 0, `no source link leaves the page (${r.navSourceLinks} found)`);
ok(r.srcHold > 0, `the source URLs survive as tooltips (${r.srcHold} .src-hold)`);

console.log(fails.length ? `SHELL: ${fails.length} FAILED` : "SHELL OK");
process.exit(fails.length ? 1 : 0);
