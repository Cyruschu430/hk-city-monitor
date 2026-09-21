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
  ["data/cameras_td.json", "cameras_td.json"],
  ["data/cameras_hko.json", "cameras_hko.json"],
  ["data/leave_plan.json", "leave_plan.json"],
  // Collector output (scripts/build_water_suspension.py) — the front end reads
  // it because the upstream host's legacy TLS is unreachable from the Worker.
  ["data/water_suspension.json", "water_suspension.json"],
  ["sources.json", "sources.json"],
];
for (const [src, dst] of files) {
  copyFileSync(join(root, src), join(out, dst));
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
      paint: { "raster-brightness-max": 0.52, "raster-contrast": 0.12 },
    },
    {
      id: "esri-imagery",
      type: "raster",
      source: "esri-imagery",
      layout: { visibility: "none" },
      paint: { "raster-brightness-max": 0.6, "raster-contrast": 0.1 },
    },
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
