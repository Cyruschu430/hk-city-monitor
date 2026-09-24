// probe-staleness.mjs — for each panel, compare the panel's own observation
// timestamp against its source's declared cadence and its quiet tolerance.
// This separates "the source is genuinely quiet" (honest) from "the freshness
// model is misconfigured" (a bug where we show amber for data that is current).
//
// MEASURED 2026-09-24: this probe used to wait a fixed 16s and then read the
// table. On a slow boot it printed ONE row and looked like a data fault; the
// audit run immediately afterwards saw all 18 panels. A probe whose readiness
// gate is a timer measures the timer, not the app — so it now waits for every
// panel to leave the loading state, and reports how many it actually saw.
import { chromium } from "playwright-core";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:4173/";
const EXPECTED_PANELS = Number(process.argv[3] ?? 18);

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await page.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });

// Readiness gate: every mounted panel must exist AND none may still be loading.
// Without this the table below is a snapshot of a half-drawn page.
await page
  .waitForFunction(
    (expected) => {
      const panels = [...document.querySelectorAll(".panel[data-panel]")];
      if (panels.length < expected) return false;
      return panels.every((p) => p.dataset.state && p.dataset.state !== "loading");
    },
    EXPECTED_PANELS,
    { timeout: 90_000 },
  )
  .catch(async () => {
    const seen = await page.evaluate(() => {
      const panels = [...document.querySelectorAll(".panel[data-panel]")];
      return { mounted: panels.length, loading: panels.filter((p) => p.dataset.state === "loading").length };
    });
    throw new Error(
      `panels never settled: ${seen.mounted} mounted (expected ${EXPECTED_PANELS}), ${seen.loading} still loading`,
    );
  });

// The freshness functions are pure and live in the app bundle, which is
// hashed. Rather than guess the chunk name, the probe imports the shipped
// source file directly: it runs from the repo, so it reads the real
// implementation instead of re-implementing it (a copy would drift and then
// the probe would agree with itself while the app was wrong).
const { quietSeconds, cadenceSeconds } = await import("../src/lib/honesty.ts");

const rows = await page.evaluate(() => {
  const reg = window.__hkcm?.registry;
  return [...document.querySelectorAll(".panel[data-panel]")].map((p) => {
    const id = p.dataset.panel;
    const panel = reg?.panels?.find((x) => x.id === id);
    const src = panel ? reg.byId.get(panel.source) : null;
    return {
      id,
      state: p.dataset.state,
      chip: p.querySelector(".chip")?.textContent?.trim() ?? "",
      time: p.querySelector(".panel-foot time")?.textContent?.trim() ?? "",
      cadence: src?.cadence ?? "(none)",
      source: panel?.source ?? "",
      cadenceNote: panel?.cadence_note?.tc ?? "",
    };
  });
});

console.log(`\n${"panel".padEnd(24)} ${"state".padEnd(6)} ${"chip".padEnd(18)} ${"cadence".padEnd(14)} quiet`);
console.log("-".repeat(96));
let staleCount = 0;
for (const r of rows) {
  // A panel with no source is synthesised client-side (analysis_brief is
  // appended by setAnalysis() from the deterministic Tier 0-4 brief). It is
  // not fetched and has no cadence, so printing a tolerance for it would
  // invent a clock that does not exist.
  const synthetic = !r.source;
  const q = synthetic ? NaN : quietSeconds(r.cadence);
  const qLabel = synthetic
    ? "n/a"
    : q >= 86_400
      ? `${Math.round(q / 86_400)}d`
      : q >= 3600
        ? `${Math.round(q / 3600)}h`
        : `${q}s`;
  if (r.state === "stale") staleCount++;
  const mark = r.state === "stale" ? "  <-- STALE" : r.state === "error" ? "  <-- ERROR" : "";
  console.log(
    `${r.id.padEnd(24)} ${String(r.state).padEnd(6)} ${r.chip.slice(0, 17).padEnd(18)} ${String(r.cadence).slice(0, 13).padEnd(14)} ${qLabel.padStart(5)}${mark}`,
  );
}
console.log(`\n${rows.length} panels · ${rows.length - staleCount} not stale · ${staleCount} stale`);
console.log(`poll cadence vs quiet tolerance, e.g. 'continuous': ${cadenceSeconds("continuous")}s vs ${quietSeconds("continuous")}s`);

if (rows.length < EXPECTED_PANELS) {
  console.error(`\nPROBE INCOMPLETE: saw ${rows.length} panels, expected ${EXPECTED_PANELS}`);
  process.exitCode = 1;
}
await browser.close();
