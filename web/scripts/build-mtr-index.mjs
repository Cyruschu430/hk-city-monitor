// Build the MTR station index the search reads.
//
// Why this exists: the MTR Next Train API takes a LINE + a 3-letter STATION CODE, never a name, so
// "search 金鐘" cannot be answered from the API alone. The official lines-and-stations CSV
// (opendata.mtr.com.hk, keyless, 274 rows) is the index - baked into the bundle at BUILD time rather
// than fetched at runtime, because it is stable, tiny, and serving it would need a Worker whitelist
// entry and a slice of the daily quota for data that never changes.
//
// Same shape as scripts/build_cameras.py: idempotent, and `--check` fails if the committed file is
// out of date instead of silently rewriting it.
//
// Usage: node scripts/build-mtr-index.mjs [--check]

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const CSV = "https://opendata.mtr.com.hk/data/mtr_lines_and_stations.csv";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "mtr-stations.json");
const check = process.argv.includes("--check");

const res = await fetch(CSV, { headers: { "User-Agent": "hk-city-monitor/0.2 (+public dashboard)" } });
if (!res.ok) throw new Error(`${CSV} -> HTTP ${res.status}`);
const text = (await res.text()).replace(/^\uFEFF/, "");

// "Line Code","Direction","Station Code","Station ID","Chinese Name","English Name","Sequence"
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const byCode = new Map();
for (const line of text.split(/\r?\n/).slice(1)) {
  if (!line.trim()) continue;
  const [lineCode, , code, , tc, en] = parseCsvLine(line);
  if (!lineCode || !code) continue;
  const cur = byCode.get(code) ?? { code, tc, en, lines: [] };
  // A station served by two lines (Admiralty: ISL + TWL) must list both, because the API is queried
  // per line - asking it for the wrong line returns nothing and would look like an empty result.
  if (!cur.lines.includes(lineCode)) cur.lines.push(lineCode);
  byCode.set(code, cur);
}

// Sequence matters for the search: an exact code or an exact name should win over a substring, and a
// prefix ("adm") over an interior hit ("north point" matching ... ) - so sort by code for stable diffs.
const stations = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
const json = JSON.stringify({ generated: new Date().toISOString().slice(0, 10), count: stations.length, stations }, null, 0) + "\n";

if (check) {
  const cur = readFileSync(OUT, "utf8");
  // The date line changes daily by design; compare the payload, not the header.
  const body = (s) => s.slice(s.indexOf("\"count\""));
  if (body(cur) !== body(json)) {
    console.error("FAIL  src/data/mtr-stations.json is out of date - re-run node scripts/build-mtr-index.mjs");
    process.exit(1);
  }
  console.log(`OK    mtr-stations.json up to date (${stations.length} stations)`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  const multi = stations.filter((s) => s.lines.length > 1).length;
  console.log(`wrote ${OUT} - ${stations.length} stations (${multi} interchange), ${json.length} bytes`);
  console.log(`spot check: ADM=${JSON.stringify(stations.find((s) => s.code === "ADM"))}`);
}
