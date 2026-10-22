// sync-data.mjs — copy the SOURCE data files (repo-root data/*.json, sources.json)
// into web/public/data/ before every build, so a deploy can never serve a stale
// registry. web/public/data/ is NOT tracked by git (it is a build-time copy).
import { cpSync, mkdirSync, existsSync } from "node:fs";

const SRC = ["../data", "."];
const DST = "public/data";
const COPY = [
  "../data/panels.json",
  "../data/layers.json",
  "../data/verticals.json",
  "../data/geojson/*.json",
  "../sources.json",
  // live snapshots published by cron (aircraft, ai_summary, berth_vacancy, …)
  "../data/aircraft.json",
  "../data/ai_summary.json",
  "../data/berth_vacancy.json",
];

mkdirSync(DST, { recursive: true });
for (const f of ["../data/panels.json", "../data/layers.json", "../data/verticals.json", "../sources.json"]) {
  if (existsSync(f)) cpSync(f, `${DST}/${f.split("/").pop()}`);
}
// every data/*.json AND *.geojson that exists at the repo root (except the internal ones)
import { readdirSync } from "node:fs";
for (const f of readdirSync("../data")) {
  if (!f.endsWith(".json") && !f.endsWith(".geojson")) continue;
  if (["baselines.json", "dataset_candidates.json", "geocode_cache.json", "sources_report.json", "leave_plan.json"].includes(f)) continue;
  cpSync(`../data/${f}`, `${DST}/${f}`);
}
// web/public/basemap/ is likewise a build-time copy. It used to be hand-maintained on whatever
// machine ran the deploy, which is why the first CI-driven deploy shipped a dist with no
// basemap/style.json at all: MapLibre fetched the path, got the SPA's index.html, and the whole
// map (and every layer on it) failed to render. The style is source, so it lives in web/basemap/.
const BASEMAP_SRC = "basemap";
const BASEMAP_DST = "public/basemap";
if (existsSync(BASEMAP_SRC)) {
  mkdirSync(BASEMAP_DST, { recursive: true });
  cpSync(BASEMAP_SRC, BASEMAP_DST, { recursive: true });
  console.log("sync-data: web/public/basemap/ refreshed from web/basemap/");
}
console.log("sync-data: web/public/data/ refreshed from repo-root data/ + sources.json");
