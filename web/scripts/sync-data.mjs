#!/usr/bin/env node
// sync-data.mjs — copies the shared registries into web/public/data/ and
// generates the MapLibre basemap style.
//
// Why this exists: the registries (data/*.json, sources.json) live at the repo
// root and are owned by the data pipeline (Hermes). The front end must not
// become a second place where they are edited — it copies them, read-only,
// at dev/build time. Deterministic, exits, no server.
//
// Basemap style: a static style.json is served as a style URL because
// MapLibre 4.7.x silently ignores an inline style object (measured pitfall,
// cost an hour). When VITE_WORKER_BASE is set, LandsD tile requests are
// routed through the Worker's edge cache — the LandsD terms forbid request
// bursts and the cache is the protection (COST.md §2). Without it, tiles go
// direct (keyless, CORS-open); local dev does not depend on wrangler running.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..");
const root = join(web, "..");
const out = join(web, "public", "data");

mkdirSync(out, { recursive: true });

const files = [
  ["data/panels.json", "panels.json"],
  ["data/verticals.json", "verticals.json"],
  ["data/layers.json", "layers.json"],
  // Tier 1 rules. This list is a manual copy step, so a NEW registry file must
  // be added here or the app silently loads nothing — which is exactly what
  // happened: rules.json shipped, the rule engine ran, and it found 0 rules.
  ["data/rules.json", "rules.json"],
  ["data/cameras_td.json", "cameras_td.json"],
  ["data/cameras_hko.json", "cameras_hko.json"],
  ["data/leave_plan.json", "leave_plan.json"],
  // Collector output (scripts/build_water_suspension.py) — the front end reads
  // it because the upstream host's legacy TLS is unreachable from the Worker.
  ["data/water_suspension.json", "water_suspension.json"],
  // Curated community live-stream list (YouTube, third-party — see source entry)
  ["data/live_streams.json", "live_streams.json"],
  ["sources.json", "sources.json"],
];

// Optional collector output. Absent on a fresh clone before the collector has run,
// and that must not fail the build: the app falls back to an empty baseline store
// and the brief says 「累積中 0/14 日」, which is the honest state. Kept in a SEPARATE
// list on purpose — a missing entry in `files` above is a typo, and it must still
// throw rather than ship a registry the app silently loads nothing from.
const optional = [["data/baselines.json", "baselines.json"]];

for (const [src, dst] of files) {
  copyFileSync(join(root, src), join(out, dst));
}
for (const [src, dst] of optional) {
  try {
    copyFileSync(join(root, src), join(out, dst));
  } catch {
    console.warn(`sync-data: no ${src} yet — the app will use an empty baseline store`);
  }
}

// --- basemap style -----------------------------------------------------------
// Tile order differs per provider and getting it backwards yields a plausible
// map in the wrong place: LandsD is {z}/{x}/{y}, Esri is {z}/{y}/{x}.
const LANDSD = "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz";
const ESRI =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";

const workerBase = (process.env.VITE_WORKER_BASE || "").replace(/\/+$/, "");
// MapLibre substitutes {z}/{x}/{y} AFTER reading the template, so the braces
// must survive URL-encoding: encode the fixed prefix, keep the tokens literal.
const tile = (tpl) =>
  workerBase ? `${workerBase}/proxy?url=${encodeURIComponent(tpl).replace(/%7B/g, "{").replace(/%7D/g, "}")}` : tpl;

// Only LandsD goes through the Worker: its terms forbid request bursts and the
// edge cache is the protection (COST.md §2). The Esri fallback is NOT in
// sources.json, so the Worker's whitelist would refuse it — routing it there
// would 403. If imagery should be cached too, add the source to sources.json,
// re-run scripts/build_worker_whitelist.py, and route it like LandsD.
const tileViaWorker = tile;

const style = {
  version: 8,
  name: "hkcm-landsd",
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    "landsd-topo": {
      type: "raster",
      tiles: [tile(`${LANDSD}/basemap/WGS84/{z}/{x}/{y}.png`)],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Map from Lands Department 地政總署",
    },
    "landsd-label-tc": {
      type: "raster",
      tiles: [tile(`${LANDSD}/label/hk/tc/WGS84/{z}/{x}/{y}.png`)],
      tileSize: 256,
      maxzoom: 19,
    },
    // Official aerial imagery — the exact layer LandsD's own 3D-map example
    // uses (mapapi.geodata.gov.hk/xyz/imagery). Keyless when served directly,
    // routed via the Worker's edge cache like the other LandsD tiles.
    "landsd-imagery": {
      type: "raster",
      tiles: [tile(`${LANDSD}/imagery/WGS84/{z}/{x}/{y}.png`)],
      tileSize: 256,
      maxzoom: 19,
    },
    "esri-imagery": {
      type: "raster",
      tiles: [`${ESRI}/{z}/{y}/{x}`], // direct — see tileViaWorker note above
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#05070d" } },
    {
      id: "landsd-topo",
      type: "raster",
      source: "landsd-topo",
      // Measured treatment (DESIGN_BRIEF §0.5): CSS brightness(0.52)+contrast(1.12)
      // keeps roads and coastline legible on a dark UI; desaturating loses roads
      // and invert is banned. MapLibre raster paint approximates it:
      // brightness-max clamps highlights, contrast is an offset from neutral.
      //
      // v0.4: a reference screenshot of World Monitor showed why the overlays
      // were not popping — its basemap is near-black, so the signal colours are
      // the ONLY saturated thing on screen. Ours kept a warm grey topo at 0.52
      // and every overlay had to compete with it.
      //
      // Measured, not guessed (scripts/probe-basemap.mjs samples the rendered
      // screenshot): with brightness-max 0.45 alone the map still rendered at
      // luma 109-113 — mid-grey, because brightness-max clamps the HIGHLIGHT
      // end and the topo tiles' midtones never reach it. The pair that actually
      // darkens the body of the image is the min/max WINDOW: raising min lifts
      // blacks, so to go dark the window is widened downward via contrast,
      // which pivots around 0.5. -0.55 saturation is a RELATIVE offset (0 =
      // unchanged, -1 = greyscale); spread measured 6-12 afterwards, i.e.
      // neutral grey, which is the intent.
      // Measured three times over, and the third is the one that matters:
      //
      // 1. brightness-max 0.45 alone → luma ~110. The clamp sets a CEILING, and
      //    the topo tiles' midtones sit far below it, so nothing moves.
      // 2. Tightening to 0.22 + contrast 0.62 → only luma 87.
      // 3. A live paint matrix (scripts/probe-basemap-matrix.mjs, rows applied
      //    via setPaintProperty and measured from screenshots) found the rule:
      //    raster-brightness-max DOES NOTHING unless raster-contrast is also
      //    set. Row "brightness-max 0.22 only" = luma 112; the same clamp WITH
      //    contrast = luma 34. That is the whole reason the first two attempts
      //    went nowhere.
      //
      // Final row: opacity 0.3 + brightness-max 0.35 + contrast 0.3 → luma 35
      // with coastline and roads still legible. A per-layer probe confirmed the
      // topo raster is the only light source (hiding it drops the patch to
      // luma 11 = the background), so darkening it IS darkening the map.
      // Spread measured ~8 afterwards: near-neutral, so the signal colours
      // (#ff5d6c / #f59e0b / #22d3ee) are the only saturated things on screen
      // — the World Monitor property this pass is chasing.
      paint: {
        "raster-opacity": 0.3,
        "raster-brightness-max": 0.35,
        "raster-contrast": 0.3,
        "raster-saturation": -0.6,
      },
    },
    {
      id: "landsd-imagery",
      type: "raster",
      source: "landsd-imagery",
      layout: { visibility: "none" },
      // Aerial at night is too dark to read; the same darkened treatment as the
      // topo keeps it usable without becoming a heatmap blob (DESIGN_BRIEF §0.5).
      // Aerial keeps MORE brightness and saturation than the topo because the
      // photograph is the point of an aerial view; the topo is scaffolding.
      paint: {
        "raster-brightness-max": 0.5,
        "raster-contrast": 0.2,
        "raster-saturation": -0.2,
      },
    },
    {
      id: "esri-imagery",
      type: "raster",
      source: "esri-imagery",
      layout: { visibility: "none" },
      paint: { "raster-brightness-max": 0.6, "raster-contrast": 0.1 },
    },
    // The label overlay is the recognition source (Traditional Chinese place
    // names) and stays full-strength in colour: desaturating it would take the
    // single most "this is Hong Kong" element down with the basemap.
    { id: "landsd-label-tc", type: "raster", source: "landsd-label-tc" },
  ],
};

mkdirSync(join(web, "public", "basemap"), { recursive: true });
writeFileSync(join(web, "public", "basemap", "style.json"), JSON.stringify(style, null, 1));

// A tiny manifest so the running app can prove which worker it was built against.
const manifest = {
  syncedAt: new Date().toISOString(),
  tilesVia: workerBase ? workerBase : "direct",
};
writeFileSync(join(out, "build-manifest.json"), JSON.stringify(manifest, null, 1));

console.log(
  `sync-data: copied ${files.length} registries, basemap style written (tiles ${manifest.tilesVia === "direct" ? "DIRECT from LandsD" : `via worker ${manifest.tilesVia}`})`,
);
