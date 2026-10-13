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

// ── 無人機助手: the embedded SUA assistant ─────────────────────────────────────────────
// Three ways this breaks silently, so all three are asserted: the button is never created;
// it shows in every mode; or the frame is blocked by our own frame-src and renders as an
// empty box. The last one is proved by the network, not by the DOM — a blocked frame leaves
// a perfectly normal-looking <iframe> behind.
const assistHits = [];
const assistFailed = [];
page.on("response", (res) => { if (res.url().includes("sua-assistant.pages.dev")) assistHits.push(res.status()); });
page.on("requestfailed", (req) => { if (req.url().includes("sua-assistant.pages.dev")) assistFailed.push(req.failure()?.errorText ?? "failed"); });

const assistBefore = await page.evaluate(() => {
  const el = document.querySelector(".drone-assist");
  return {
    exists: !!el,
    visible: !!el && getComputedStyle(el).display !== "none",
    frames: document.querySelectorAll(".drone-assist iframe").length,
  };
});
const enteredDrone = await page.evaluate(async () => {
  // The mode control is a <select> in the status bar, not a rail button (probe-modes.mjs
  // found no .rail-btn carrying a mode name at all). Drive it the way the reader does —
  // set the value, fire change — and identify it by the option rather than by position.
  const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "drone"));
  if (!(sel instanceof HTMLSelectElement)) return false;
  sel.value = "drone";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1500));
  return true;
});
const assistInMode = await page.evaluate(() => {
  const el = document.querySelector(".drone-assist");
  const headEl = document.querySelector(".drone-assist-head");
  const head = headEl?.getBoundingClientRect();
  const cs = headEl ? getComputedStyle(headEl) : null;
  const band = document.querySelector("#mapWrap")?.getBoundingClientRect();
  return {
    visible: !!el && getComputedStyle(el).display !== "none",
    frames: document.querySelectorAll(".drone-assist iframe").length,
    headTop: head ? Math.round(head.top) : null,
    headBottom: head ? Math.round(head.bottom) : null,
    // The shape was the request: one round button, chat-widget style.
    round: head ? Math.abs(head.width - head.height) <= 2 && (cs?.borderRadius ?? "").startsWith("50%") : false,
    headW: head ? Math.round(head.width) : 0,
    name: headEl?.getAttribute("aria-label") ?? null,
    insideBand: head && band ? head.top >= band.top - 1 && head.bottom <= band.bottom + 1 : null,
    badgeTop: Math.round(document.querySelector(".landsd-badge")?.getBoundingClientRect().top ?? 0),
  };
});
await page.evaluate(async () => {
  const head = document.querySelector(".drone-assist-head");
  if (head instanceof HTMLElement) head.click();
  await new Promise((r) => setTimeout(r, 6000));
});
const assistOpen = await page.evaluate(() => {
  const f = document.querySelector(".drone-assist iframe");
  const box = f?.getBoundingClientRect();
  const band = document.querySelector("#mapWrap")?.getBoundingClientRect();
  const panel = document.querySelector(".drone-assist-body")?.getBoundingClientRect();
  const placard = document.querySelector(".mh-scope")?.getBoundingClientRect();
  const clock = document.querySelector(".mh-clock")?.getBoundingClientRect();
  const badge = document.querySelector(".landsd-badge")?.getBoundingClientRect();
  // The panel and the map's own furniture must never straddle each other: either the panel is
  // clear of a label, or it covers it whole. Half a label under a panel edge is the thing that
  // reads as broken — and it is one pixel away from the version that reads as tidy, which is
  // why it is asserted as an invariant instead of as a width.
  const overlaps = (a, b) => !(a.left >= b.right || a.right <= b.left || a.top >= b.bottom || a.bottom <= b.top);
  const covers = (a, b) => a.top <= b.top && a.left <= b.left && a.bottom >= b.bottom && a.right >= b.right;
  const straddles = (a, b) => overlaps(a, b) && !covers(a, b);
  const headEl = document.querySelector(".drone-assist-head");
  return {
    frames: document.querySelectorAll(".drone-assist iframe").length,
    src: f?.getAttribute("src") ?? null,
    height: box ? Math.round(box.height) : 0,
    panel: panel ? { top: Math.round(panel.top), left: Math.round(panel.left), right: Math.round(panel.right), bottom: Math.round(panel.bottom) } : null,
    band: band ? { top: Math.round(band.top), left: Math.round(band.left), right: Math.round(band.right) } : null,
    straddlesPlacard: panel && placard ? straddles(panel, placard) : null,
    straddlesClock: panel && clock ? straddles(panel, clock) : null,
    // Narrower than the band on purpose: at full band width the assistant reads as cramped.
    widthOfBand: panel && band ? +(panel.width / band.width).toFixed(2) : null,
    // The licence credit must never end up behind the assistant.
    badgeVisibleBelow: !!(panel && badge) && badge.top >= panel.bottom - 2,
    markSrc: document.querySelector('.drone-assist-head img')?.getAttribute('src') ?? null,
    markLoaded: !!document.querySelector('.drone-assist-head img')?.complete,
    // The launcher is the only close control we own, so it stays put and shows the close mark.
    launcherVisible: headEl ? getComputedStyle(headEl).display !== "none" : false,
    launcherGlyph: document.querySelector(".drone-assist-close") ? getComputedStyle(document.querySelector(".drone-assist-close")).display : "missing",
    loadingGone: !document.querySelector(".drone-assist-load"),
  };
});
// The frame's ⤢ asks us to enlarge it. Three things matter: the request has to arrive, it has
// to be refused from any other origin, and it has to be a toggle rather than a one-way trip.
const expandTest = await page.evaluate(async () => {
  const rect = () => document.querySelector(".drone-assist-body").getBoundingClientRect();
  const fire = (origin) =>
    window.dispatchEvent(new MessageEvent("message", { data: { type: "sua:expand" }, origin }));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const before = rect();
  // A message from a frame that is not the assistant must not resize our panel.
  fire("https://example.com");
  await wait(150);
  const afterHostile = rect();
  // And the assistant's own request must, from the real origin it would carry.
  fire("https://sua-assistant.pages.dev");
  await wait(250);
  const enlarged = rect();
  const band = document.querySelector("#mapWrap").getBoundingClientRect();
  const placard = document.querySelector(".mh-scope").getBoundingClientRect();
  const overlaps = (a, b) => !(a.left >= b.right || a.right <= b.left || a.top >= b.bottom || a.bottom <= b.top);
  const covers = (a, b) => a.top <= b.top && a.left <= b.left && a.bottom >= b.bottom && a.right >= b.right;
  fire("https://sua-assistant.pages.dev");
  await wait(250);
  const back = rect();
  return {
    before: Math.round(before.width), afterHostile: Math.round(afterHostile.width),
    enlarged: Math.round(enlarged.width), bandW: Math.round(band.width),
    enlargedStraddles: overlaps(enlarged, placard) && !covers(enlarged, placard),
    back: Math.round(back.width),
  };
});

// The synthetic event above proves the handler; this proves the whole path — a real click on
// the real ⤢ inside the third-party frame, crossing the origin boundary for real.
const assistFrame = page.frames().find((f) => f.url().includes("sua-assistant.pages.dev"));
let realExpand = null;
if (assistFrame) {
  const width = () => page.evaluate(() => Math.round(document.querySelector(".drone-assist-body").getBoundingClientRect().width));
  const before = await width();
  try {
    await assistFrame.click('button[title="Expand"]');
    await new Promise((r) => setTimeout(r, 600));
    const after = await width();
    await assistFrame.click('button[title="Expand"]');
    await new Promise((r) => setTimeout(r, 600));
    realExpand = { before, after, back: await width() };
  } catch (err) {
    realExpand = { failed: String(err) };
  }
}

// It also has to work: a close control that does not close is worse than none.
const closedByLauncher = await page.evaluate(async () => {
  const head = document.querySelector(".drone-assist-head");
  if (head instanceof HTMLElement) head.click();
  await new Promise((r) => setTimeout(r, 700));
  const el = document.querySelector(".drone-assist");
  return { open: !!el?.classList.contains("is-open"), body: !!document.querySelector(".drone-assist-body") && getComputedStyle(document.querySelector(".drone-assist-body")).display !== "none" };
});
await page.evaluate(async () => {
  document.querySelector(".drone-assist-head")?.click();
  await new Promise((r) => setTimeout(r, 900));
});
// Leave the mode again: the button must go away with it, and take the frame with it.
const leftDrone = await page.evaluate(async () => {
  const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "overview"));
  if (!(sel instanceof HTMLSelectElement)) return null;
  sel.value = "overview";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 900));
  const el = document.querySelector(".drone-assist");
  return { visible: !!el && getComputedStyle(el).display !== "none", open: !!document.querySelector(".drone-assist.is-open") };
});

ok(assistBefore.exists, "the drone assistant button is created with the shell");
ok(!assistBefore.visible, "the drone assistant stays out of the way outside drone mode");
ok(assistBefore.frames === 0, "the drone assistant fetches nothing until it is opened (no third-party frame at boot)");
ok(enteredDrone, "the mode control selects 無人機模式");
ok(assistInMode.visible, "the drone assistant appears in 無人機模式");
ok(assistInMode.frames === 0, "the assistant still fetched nothing when its mode opened it");
ok(assistOpen.frames === 1 && (assistOpen.src ?? "").includes("sua-assistant.pages.dev"),
  `the assistant frame points at the published embed page (${assistOpen.src})`);
ok(assistOpen.height > 120, `the assistant frame has a usable height (${assistOpen.height}px)`);
ok(assistHits.length > 0 && assistHits.every((s) => s < 400),
  `the assistant page actually loaded inside the frame (status ${assistHits.join(",") || "none"}; no response at all means our own frame-src blocked it)`);
ok(assistFailed.length === 0, `no blocked or failed request to the assistant (${assistFailed.join(",") || "none"})`);
ok(assistInMode.insideBand !== false, `the assistant's button stays inside the map band (button top ${assistInMode.headTop}, LandsD notice top ${assistInMode.badgeTop})`);
ok(assistOpen.loadingGone, "the loading hint is replaced once the frame is in (it must not sit over a loaded page)");
ok(assistInMode.round, `the assistant button is the round widget button it was asked to be (${assistInMode.headW}px)`);
ok(!!assistInMode.name && assistInMode.name.length > 4, `the icon-only button keeps an accessible name (${assistInMode.name})`);
ok(assistOpen.straddlesPlacard === false, `the open assistant never half-covers the map placard (panel ${JSON.stringify(assistOpen.panel)})`);
ok(assistOpen.straddlesClock === false, "the open assistant never half-covers the clock");
ok(assistOpen.widthOfBand !== null && assistOpen.widthOfBand <= 0.6, `the open assistant is narrower than the band, not a full-width sheet (${assistOpen.widthOfBand} of it)`);
ok(assistOpen.badgeVisibleBelow, "the LandsD credit stays visible under the open assistant");
ok(assistOpen.markLoaded, `the button carries the project mark, and it loaded (${assistOpen.markSrc})`);
ok(assistOpen.launcherVisible && assistOpen.launcherGlyph === "block", `the launcher stays put as the way out, showing the close mark (${assistOpen.launcherGlyph})`);
ok(expandTest.afterHostile === expandTest.before, `a resize request from another origin is refused (${expandTest.before}px panel)`);
ok(expandTest.enlarged > expandTest.before + 100, `the assistant's own ⤢ enlarges the panel rather than opening the full app (${expandTest.before} → ${expandTest.enlarged}px of a ${expandTest.bandW}px band)`);
ok(expandTest.enlargedStraddles === false, "the enlarged panel still does not half-cover the placard");
ok(expandTest.back === expandTest.before, `the same control shrinks it back (${expandTest.back}px)`);
ok(!!realExpand && !realExpand.failed && realExpand.after > realExpand.before && realExpand.back === realExpand.before,
  `the ⤢ inside the frame really resizes the panel across the origin boundary (${JSON.stringify(realExpand)})`);
ok(closedByLauncher && !closedByLauncher.open && !closedByLauncher.body, "the launcher closes the panel it opened");
ok(leftDrone && !leftDrone.visible && !leftDrone.open, "leaving drone mode puts the assistant and its frame away");

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
