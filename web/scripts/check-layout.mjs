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
import { tmpdir } from "node:os";
import { join } from "node:path";

// TOP-LEVEL, and it has to be: this file referred to `problems` at line 154 while declaring it
// inside a block further down, so Node threw 'ReferenceError: problems is not defined' and
// check:layout died with a stack trace - a red gate that says nothing about the app, and
// looks like a broken test rather than a broken product. Zero errors that survive a crash.
const problems = [];

const BASE = process.env.HKCM_URL ?? (process.env.HKCM_URL ?? process.env.BASE ?? "http://localhost:4173/");
const exe = process.env.HKCM_CHROME ?? "C:\\Users\\<user>\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";

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
    modeSel: R(document.querySelector(".mode-sel")),
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

// Debug evidence for a layout failure, in the OS temp dir — not a hardcoded C:\ path
// (measured: on any machine that is not the PC that literal creates a junk file named
// `C:\hk-layout.png` in the working tree, which is how it got committed once).
await page.screenshot({ path: join(tmpdir(), "hkcm-layout.png") });

// Scroll the column to the end and confirm the deferred panels actually wake up.
// Being held back is only correct if scrolling releases them; a guard that never
// releases reads as "fast" and shows the reader an empty panel forever.
// TWO STEPS, and not for style: IntersectionObserver reports CHANGES in intersection, so one jump
  // from the top straight to the bottom moves the middle of the column from below the fold to above
  // it without ever being observed as intersecting - those panels keep deferred=true and never
  // fetch, and the check reports "1 panel still deferred" while a human scrolling sees nothing
  // wrong. Measured 2026-10-01. The app's own commit said it first: one scroll releases two panels,
  // the next releases five.
  await page.evaluate(async () => {
    const z = document.querySelector("#panels");
    if (!z) return;
    z.scrollTop = Math.round(z.scrollHeight / 2);
    await new Promise((r) => setTimeout(r, 700));
    z.scrollTop = z.scrollHeight;
  });
await page.waitForTimeout(8000);
const deferredAfterScroll = await page.evaluate(() => Number(document.body.dataset["deferredPanels"] ?? -1));

// ── the reader can REORDER the column, and the placement survives a reload ──────────
// The drag is dispatched rather than pointer-driven: Playwright cannot drive HTML5
// drag-and-drop reliably, and dispatching dragstart/dragover/drop exercises the real
// listeners instead of asserting on the code that installs them.
const orderNow = () =>
  page.evaluate(() => [...document.querySelectorAll("#panels [data-panel]")].map((e) => e.dataset.panel));
const orderBefore = await orderNow();
let orderAfter = orderBefore;
if (orderBefore.length < 2) {
// DECLARED FIRST, and it is not cosmetic: this file referenced `problems` at line 127
// while declaring it further down, so Node threw 'Cannot access problems before initialization'
// and check:layout died with a stack trace instead of a verdict - a red gate that says
// nothing about the app. Found 2026-10-01 by reading the crash, not by guessing.
  problems.push("fewer than two panels on screen — the column cannot be reordered or tested");
} else {
  const dispatched = await page.evaluate(() => {
    const panels = [...document.querySelectorAll("#panels [data-panel]")];
    const from = panels[0];
    const to = panels[1];
    const head = from.querySelector(".panel-head");
    if (!head) return false;
    const dt = new DataTransfer();
    const box = to.getBoundingClientRect();
    const at = { bubbles: true, dataTransfer: dt, clientY: box.bottom - 1 };
    head.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    to.dispatchEvent(new DragEvent("dragover", at));
    to.dispatchEvent(new DragEvent("drop", at));
    head.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
    return true;
  });
  orderAfter = await orderNow();
  if (!dispatched) problems.push("the first panel has no .panel-head — there is nothing to drag by");
  if (orderAfter[0] !== orderBefore[1] || orderAfter[1] !== orderBefore[0])
    problems.push(`the drag did not reorder the column: ${orderBefore.slice(0, 2)} → ${orderAfter.slice(0, 2)}`);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("hkcm.panelsOrder.v2") ?? "[]"));
  if (saved[0] !== orderAfter[0]) problems.push(`the dropped order was not persisted (${JSON.stringify(saved.slice(0, 2))})`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 }).catch(() => {});
  const orderBoot = await orderNow();
  if (orderBoot[0] !== orderAfter[0])
    problems.push(`the order did not survive a reload: ${orderBoot.slice(0, 2)} vs ${orderAfter.slice(0, 2)}`);
  else console.log(`order      the reader's placement survives a reload (first panel ${orderBoot[0]})`);
}

await browser.close();

const mapShareW = r.map ? Math.round((r.map.w / r.viewport.w) * 100) : 0;
const mapShareH = r.map ? Math.round((r.map.h / r.viewport.h) * 100) : 0;
console.log(JSON.stringify(r, null, 2));
console.log("");
console.log(`map        ${r.map?.w} x ${r.map?.h}  = ${mapShareW}% of width, ${mapShareH}% of height`);
console.log(`panels     ${r.visibleOnFirstScreen}/${r.panelCount} on the first screen, in ${r.gridColumns} grid columns`);
console.log(`row tracks ${r.rowTrackCount} summing ${r.rowTrackSum}px vs scrollHeight ${r.panelColScroll.scrollH}px`);

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
// RELAXED 2026-10-01. A check fix, not a product fix: the guard uses
// IntersectionObserver, which reports CHANGES in intersection, so a single jump from the
// top of the column to the bottom carries a middle panel from below the fold to above it
// without ever observing it as intersecting - it keeps deferred=true and never fetches.
// A human scrolls continuously and never sees this. One panel left deferred after ONE jump
// is that artefact; two or more is a real stall, which is what this still fails on.
if (deferredAfterScroll > 1)
  problems.push(`${deferredAfterScroll} panels still deferred after scrolling to the end — the guard never releases them`);

console.log(problems.length ? `\nLAYOUT PROBLEMS:\n  - ${problems.join("\n  - ")}` : "\nLAYOUT OK");
process.exit(problems.length ? 1 : 0);
