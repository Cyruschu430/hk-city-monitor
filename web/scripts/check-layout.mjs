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
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 }).catch(() => {});
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
    overlaps: overlaps.slice(0, 10),
    overlapCount: overlaps.length,
    bodyScroll: { w: document.body.scrollWidth, h: document.body.scrollHeight },
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2,
  };
});

await page.screenshot({ path: "C:\\hk-layout.png" });
await browser.close();

const mapShareW = r.map ? Math.round((r.map.w / r.viewport.w) * 100) : 0;
const mapShareH = r.map ? Math.round((r.map.h / r.viewport.h) * 100) : 0;
console.log(JSON.stringify(r, null, 2));
console.log("");
console.log(`map        ${r.map?.w} x ${r.map?.h}  = ${mapShareW}% of width, ${mapShareH}% of height`);
console.log(`panels     ${r.visibleOnFirstScreen}/${r.panelCount} on the first screen, in ${r.gridColumns} grid columns`);
console.log(`row tracks ${r.rowTrackCount} summing ${r.rowTrackSum}px vs scrollHeight ${r.panelColScroll.scrollH}px`);

const problems = [];
if (r.overlapCount > 0) problems.push(`${r.overlapCount} panel overlaps (must be 0)`);
// scrollHeight is row tracks PLUS the container's padding and the gaps between tracks — the
// first version of this check compared the two raw and reported a 52px "failure" that was exactly
// 8px + 8px padding + 6 gaps x 6px. Compare like with like.
const expected = r.rowTrackSum + r.panelPadY + r.panelGapY;
if (Math.abs(expected - r.panelColScroll.scrollH) > 4)
  problems.push(`row tracks + padding + gaps = ${expected} but scrollHeight is ${r.panelColScroll.scrollH} — the documented trap`);
if (r.horizontalOverflow) problems.push("horizontal page overflow");
if (mapShareW < 85) problems.push(`map is only ${mapShareW}% wide`);
if (r.gridColumns < 3) problems.push(`only ${r.gridColumns} panel columns`);

console.log(problems.length ? `\nLAYOUT PROBLEMS:\n  - ${problems.join("\n  - ")}` : "\nLAYOUT OK");
process.exit(problems.length ? 1 : 0);
