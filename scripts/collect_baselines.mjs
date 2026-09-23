// scripts/collect_baselines.mjs — fold today's readings into data/baselines.json.
//
// Why this exists: baseline.ts requires MIN_DAYS = 14 distinct days before ANY
// baseline-derived event may fire, and in the browser the store lives in memory, so
// it resets on every reload. Without a collector the brief honestly says
// 「累積中 0/14 日」 forever and Tier 1 can never fire — true, but useless.
//
// Why Node and not Python like its siblings (build_cameras.py,
// build_water_suspension.py): the four signals are extracted by the ADAPTERS — the
// A&E Chinese-duration parser, the ImD 99 sentinel, and the CSO station join that
// wind needs before a speed counts. Re-deriving those in Python is exactly how the
// rule engine and the panel would start disagreeing. Node 22 strips types, so this
// imports the app's own modules and gets the same numbers.
//
// Why it fetches each source directly: CORS is a browser restriction. Server-side
// there is no preflight, so every source is readable from its own URL and the
// collector needs no Worker and no key.
//
// SCHEDULE: HOURLY, not daily. baseline.ts buckets by (day-of-week, hour-of-day)
// — 7 x 24 = 168 buckets per signal — and maturity() counts distinct DAYS. Running
// once a day would fill one hour-bucket out of 24, so a rule evaluated at any other
// hour finds no baseline for that bucket and stays immature forever. Hourly gives
// 24 buckets a day, 14 days of them, for 96 free keyless fetches a day.
//
// Run: node scripts/collect_baselines.mjs [--dry-run]

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DATA = join(ROOT, "data");
const DRY = process.argv.includes("--dry-run");

// The app's modules expect a browser. This is the whole surface they touch at
// import time: i18n reads a stored language key, live.ts checks for Image.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document = { documentElement: { lang: "zh-HK" } };

// The repo is FLAT at the root: sources.json sits beside the docs, while the other
// four registries live in data/. Paths are repo-relative here so that asymmetry is
// visible in one place instead of being rediscovered.
const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8").replace(/^\uFEFF/, ""));

const { adaptPanel } = await import("../web/src/lib/adapters.ts");
const { updateBaselines, BASELINE_SIGNALS } = await import("../web/src/lib/analytics/index.ts");
const { emptyStore, BASELINE_VERSION, daysObserved, MIN_DAYS } = await import("../web/src/lib/analytics/baseline.ts");

const sources = read("sources.json").sources; // repo root, not data/
// Force the direct route: `fetch: "proxy"` only exists because a BROWSER cannot
// read those hosts. Here there is no CORS, so the proxy hop would add a dependency
// on a deployed Worker for nothing.
for (const s of sources) s.fetch = "browser";

const registry = {
  panels: read("data/panels.json").panels,
  verticals: read("data/verticals.json").verticals,
  layers: read("data/layers.json").layers,
  sources,
  byId: new Map(sources.map((s) => [s.id, s])),
  rules: read("data/rules.json").rules,
};
const ctx = { registry, raster: { nowcast: async () => "", tcTrack: async () => "" } };
const synthetic = (id) => ({ id: `collect_${id}`, source: id, render: "list", title: { tc: "", en: "" }, cadence_note: { tc: "", en: "" } });

const state = {};
const lines = [];
let failures = 0;

for (const sig of BASELINE_SIGNALS) {
  // Reuse the panel the app mounts, so any params (bbox, stations, symbols) match.
  const panel = registry.panels.find((p) => p.source === sig.source) ?? synthetic(sig.source);
  try {
    const { state: published } = await adaptPanel(panel, ctx);
    if (published === undefined || published === null) {
      lines.push(`  ${sig.source}.${sig.field} — adapter published no state, skipped`);
      failures += 1;
      continue;
    }
    state[sig.source] = published;
    const v = published[sig.field];
    lines.push(`  ${sig.source}.${sig.field} = ${v === undefined || v === null ? "null (not an observation)" : v}`);
  } catch (e) {
    lines.push(`  ${sig.source}.${sig.field} — FETCH/PARSE FAILED: ${e instanceof Error ? e.message : String(e)}`);
    failures += 1;
  }
}

const OUT = join(DATA, "baselines.json");
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : emptyStore();
const before = JSON.stringify(prev);
const next = updateBaselines(prev, state, new Date());
const changed = JSON.stringify(next) !== before;

console.log("collect_baselines — %s", new Date().toISOString());
console.log("signals fetched:");
console.log(lines.join("\n") || "  (none)");
// Plain interpolation, not printf: console.log has no width/precision specifiers,
// and `%-52s` silently shifts every following argument (measured: it printed the
// literal and then fed a string to %d, which read as NaN).
console.log(`maturity (MIN_DAYS = ${MIN_DAYS}):`);
for (const sig of BASELINE_SIGNALS) {
  const key = `${sig.source}.${sig.field}`;
  console.log(`  ${key.padEnd(52)} ${daysObserved(next, key)}/${MIN_DAYS} days`);
}
console.log("store: %s -> %s", existsSync(OUT) ? "read" : "absent", changed ? "CHANGED" : "unchanged (same day, or no readings)");

if (DRY) {
  console.log("--dry-run: nothing written");
} else if (changed) {
  // Atomic: a reader must never see a half-written store.
  const tmp = OUT + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 1), "utf8");
  renameSync(tmp, OUT);
  console.log("wrote %s (version %d, %d signals, %d days recorded)", OUT, BASELINE_VERSION, Object.keys(next.signals).length, Object.keys(next.days).length);
} else {
  // Only reachable when the readings are byte-identical to the stored aggregates —
  // a same-day re-run normally CHANGES the file, because a second sample refines
  // that (dow, hour) bucket's mean while `days` stays the same. That is correct:
  // the 14-day gate counts DAYS, and more samples per hour make the bucket better.
  console.log("no write: identical readings, store unchanged");
}

process.exit(failures === BASELINE_SIGNALS.length ? 1 : 0);
