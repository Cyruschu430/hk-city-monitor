// check-layout.mjs — the shell's geometry, asserted rather than eyeballed.
//
// app.css carries a measured warning on #panels: the row track MUST be `max-content` or panels
// clip, and "if you change anything here, assert BOTH: zero overlaps AND scrollHeight equal to the
// sum of the row tracks. Checking only one of them is how this shipped broken twice."
//
// That is a testable claim, so this tests it — plus the questions the review could only answer by
// measurement: how much of the viewport the map actually gets, and how much of the panel set is
// visible without scrolling.
import { chromium } from "playwright-core";

const BASE = process.env.HKCM_URL ?? "http://127.0.0.1:4173/";
const exe = process.env.HKCM_CHROME ?? "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
// A swallowed readiness timeout measures an EMPTY shell and then reports LAYOUT OK. MEASURED
// 2026-09-27: a cold preview start produced "panels 0/0 ... LAYOUT OK" while the same server
// served 16 panels moments later. Every assertion below is about the relationship between
// elements, and no relationship is violated by having none of them — so a check that can pass on
// a blank page is worse than no check. The timeout is fatal.
// Retry the navigation ONCE. A cold browser backend loses the first navigation — measured
// repeatedly in this repo: the identical run succeeds on the second attempt. Fatal-but-single-shot
// turns that flake into a red check: MEASURED 2026-09-27, check:all exit=1 on a healthy build for
// exactly this. Two failures IS a result, so the guard stays fatal — it just stops crying wolf.
let booted = false;
for (let attempt = 1; attempt <= 2 && !booted; attempt++) {
  try {
    await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 });
    booted = true;
    if (attempt > 1) console.log("(booted on retry — the first navigation was a cold-start miss)");
  } catch {
    if (attempt === 1) await page.goto(BASE, { waitUntil: "domcontentloaded" });
  }
}
if (!booted) {
  console.error("readiness timeout on both attempts: document.body.dataset.ready never became 1 - the app failed to boot.");
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(10000);

const r = await page.evaluate(() => {
  const R = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };
  const map = document.querySelector("#map canvas");
  const panelsEl = document.querySelector("#panels");
  const panels = [...document.querySelectorAll("#panels section.panel")];
  const tracks = getComputedStyle(panelsEl).gridTemplateRows.split(/\s+/).map((v) => parseFloat(v)).filter((n) => !Number.isNaN(n));

  // pairwise overlap between panels — the defect `align-items:start` produced (42 overlaps)
  const boxes = panels.map((p) => ({ id: p.dataset.panelId ?? p.id ?? "?", ...R(p) }));
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    if (ox > 2 && oy > 2) overlaps.push({ a: a.id, b: b.id, px: ox * oy });
  }

  // which grid columns the panels actually landed in
  const cols = [...new Set(boxes.map((b) => b.x))].sort((p, q) => p - q);

  return {
    viewport: { w: innerWidth, h: innerHeight },
    map: map ? R(map) : null,
    mapWrap: R(document.querySelector("#mapWrap")),
    panelCol: R(document.querySelector("#panelCol")),
    rail: R(document.querySelector("#rail")),
    panelCount: panels.length,
    visibleOnFirstScreen: boxes.filter((b) => b.y < innerHeight).length,
    panelColScroll: { scrollH: panelsEl.scrollHeight, clientH: panelsEl.clientHeight },
    rowTrackSum: Math.round(tracks.reduce((s, n) => s + n, 0)),
    rowTrackCount: tracks.length,
    panelPadY: (() => { const cs = getComputedStyle(panelsEl); return parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom); })(),
    panelGapY: (() => { const cs = getComputedStyle(panelsEl); return parseFloat(cs.rowGap) * Math.max(0, tracks.length - 1); })(),
    panelHeights: boxes.map((b) => b.h).sort((x, y) => y - x),
    gridColumns: getComputedStyle(panelsEl).gridTemplateColumns.split(/\s+/).length,
    distinctXPositions: cols.length,
    // The off-screen fetch guard writes how many panels it is still holding back.
    // Read it here rather than counting requests: a request count cannot tell a
    // deferred panel from a camera thumbnail, which is exactly how a working guard
    // was once read as broken.
    deferredAtBoot: Number(document.body.dataset["deferredPanels"] ?? -1),
    overlaps: overlaps.slice(0, 10),
    overlapCount: overlaps.length,
    bodyScroll: { w: document.body.scrollWidth, h: document.body.scrollHeight },
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2,
  };
});

await page.screenshot({ path: "C:\\hk-layout.png" });

// Scroll the column to the end and confirm the deferred panels actually wake up.
// Being held back is only correct if scrolling releases them; a guard that never
// releases reads as "fast" and shows the reader an empty panel forever.
await page.evaluate(() => { const z = document.querySelector("#panels"); if (z) z.scrollTop = z.scrollHeight; });
await page.waitForTimeout(8000);
const deferredAfterScroll = await page.evaluate(() => Number(document.body.dataset["deferredPanels"] ?? -1));
await browser.close();

const mapShareW = r.map ? Math.round((r.map.w / r.viewport.w) * 100) : 0;
const mapShareH = r.map ? Math.round((r.map.h / r.viewport.h) * 100) : 0;
console.log(JSON.stringify(r, null, 2));
console.log("");
console.log(`map        ${r.map?.w} x ${r.map?.h}  = ${mapShareW}% of width, ${mapShareH}% of height`);
console.log(`panels     ${r.visibleOnFirstScreen}/${r.panelCount} on the first screen, in ${r.gridColumns} grid columns`);
console.log(`row tracks ${r.rowTrackCount} summing ${r.rowTrackSum}px vs scrollHeight ${r.panelColScroll.scrollH}px`);

const problems = [];
// No panels means every other assertion is vacuously true.
if (r.panelCount === 0) problems.push("0 panels rendered - the geometry below describes an empty shell, not the app");
if (r.overlapCount > 0) problems.push(`${r.overlapCount} panel overlaps (must be 0)`);
// scrollHeight is row tracks PLUS the container's padding and the gaps between tracks — the
// first version of this check compared the two raw and reported a 52px "failure" that was exactly
// 8px + 8px padding + 6 gaps x 6px. Compare like with like.
const expected = r.rowTrackSum + r.panelPadY + r.panelGapY;
if (Math.abs(expected - r.panelColScroll.scrollH) > 4)
  problems.push(`row tracks + padding + gaps = ${expected} but scrollHeight is ${r.panelColScroll.scrollH} — the documented trap`);
if (r.horizontalOverflow) problems.push("horizontal page overflow");
// 85% was written for the stacked layout, where the map spanned the full window. In the split it shares
// the width with the rail (56px) and the panel column (clamp 320-560px), so at 1920px the map gets 1304px
// = 68%. The number that matters now is that the map still keeps the large majority of the window; the
// panel column's own clamp is asserted by the single-column + scroll checks below.
if (mapShareW < 60) problems.push(`map is only ${mapShareW}% wide — the split must still leave it the majority`);
// The panel column is now a SIDE-RAIL scroller, so one column is correct — the old bottom-band layout
// wanted three across and this line asserted it. What must hold instead is that the column actually
// scrolls. That is the whole point of `#panelCol`, and it is exactly what broke: an orphaned CSS block
// from the 3D-button removal swallowed the `#panelCol` rule, so the column kept `display:block` and
// `overflow:visible`, 4693px of panels sat inside a 988px column, scrollHeight equalled clientHeight, and
// the panel list simply ran off the bottom of the window. Asserting the new contract would have caught
// it; asserting the old one could only go permanently red and hide the next defect.
const pc = r.panelColScroll;
if (r.gridColumns !== 1) problems.push(`panel column must be a single column, found ${r.gridColumns}`);
if (pc.scrollH <= pc.clientH + 2)
  problems.push(`panel column does not scroll: scrollHeight ${pc.scrollH} <= clientHeight ${pc.clientH}`);

if (r.deferredAtBoot < 0)
  problems.push("no deferredPanels signal on <body> — the off-screen fetch guard is absent");
else if (r.deferredAtBoot === 0)
  problems.push("0 panels deferred at boot — every panel fetched immediately, the guard is not engaging");
else if (r.deferredAtBoot >= r.panelCount)
  problems.push(`all ${r.panelCount} panels deferred at boot — nothing loads until a scroll`);
else console.log(`deferred   ${r.deferredAtBoot}/${r.panelCount} held back at boot, ${deferredAfterScroll} still held back after scrolling to the end`);
if (deferredAfterScroll !== 0)
  problems.push(`${deferredAfterScroll} panels still deferred after scrolling to the end — the guard never releases them`);

console.log(problems.length ? `\nLAYOUT PROBLEMS:\n  - ${problems.join("\n  - ")}` : "\nLAYOUT OK");
process.exit(problems.length ? 1 : 0);
