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
  // One curated list, region-tabbed: 17 HK cameras + 16 international news channels.
  ["data/live_streams.json", "live_streams.json"],
  // Collector output (scripts/build_carpark_info.py). Slimmed from TD's 554KB basic_info_all.json
  // to the three fields the panel reads — see the note in the source entry. This is the file a
  // browser was downloading all of on every cold load.
  ["data/carpark_info.json", "carpark_info.json"],
  // Immigration control points with VALIDATED WGS84 positions, so 口岸模式 can
  // plot the crossings as POIs with popups instead of only camera dots. Reference
  // data, not a feed — see the _method note in the file for how each coordinate
  // was checked before it was allowed in.
  ["data/control_points.json", "control_points.json"],
  // sources.json is COPIED, not shipped as-is: see the slim pass below.
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

// --- sources.json: ship only what the front end reads -------------------------
//
// MEASURED 2026-09-27. The registry is 153KB pretty-printed and it is on the CRITICAL PATH:
// the app fetches data/sources.json during boot for panel footers and layer names. Its two
// biggest per-entry fields are `notes` (38% of all field bytes) and `candidates` (9%), and
// NEITHER IS READ BY THE FRONT END — grepping src/ for `.notes`, `.candidates`, `.license`,
// `.cors_note`, `.cost`, `.kind` and `.auto` returns nothing. They are registry
// documentation: the data pipeline and a human reviewer need them, and they stay in the
// root sources.json completely untouched. This is not deleting documentation; it is
// declining to download it.
//
// `_comment` and `_schema` DO ship. Nothing reads them either, but the shipped file is a
// public artefact and this one is small (1.3KB) and is what tells a reader what the shape
// they are looking at means.
//
// The keep-list is a literal, not derived from the TS interface, because a build script
// cannot read a type. That makes this the failure to watch: ADD A FIELD HERE WHEN YOU READ
// IT IN src/. A field missing from this list is undefined at runtime while the registry
// looks perfectly fine, and nothing else in the build will tell you.
const SHIPPED_SOURCE_FIELDS = ["id", "group", "name", "name_en", "url_en", "type", "url", "auth", "cadence", "fetch"];
const sourcesRaw = JSON.parse(readFileSync(join(root, "sources.json"), "utf8"));
const slimSources = {
  ...sourcesRaw,
  sources: sourcesRaw.sources.map((entry) => {
    const kept = {};
    for (const k of SHIPPED_SOURCE_FIELDS) if (entry[k] !== undefined) kept[k] = entry[k];
    return kept;
  }),
};
// Compact, not pretty: this file is fetched by a browser, never read in a diff.
writeFileSync(join(out, "sources.json"), JSON.stringify(slimSources));
const before = readFileSync(join(root, "sources.json")).length;
const after = readFileSync(join(out, "sources.json")).length;
console.log(`sync-data: sources.json ${before} -> ${after} bytes (${Math.round((1 - after / before) * 100)}% smaller on the critical path)`);

// --- basemap style -----------------------------------------------------------
// R1 (docs/SOURCE_COVERAGE_REVIEW.md). These URLs used to be HARDCODED here, so
// `landsd_basemap_tiles`, `landsd_label_tiles`, `landsd_imagery_tiles`,
// `esri_world_imagery` and `carto_dark_style` all read as "referenced by nothing"
// in the registry while the map depended on them — and if LandsD moved a path,
// no registry entry needed editing and `validate_config.py` (which walks
// sources.json, not this generated file) stayed green. That is the same class of
// defect as Pitfall 27's dead CSS selector: a reference that looks live and
// matches nothing. The URLs now come FROM the registry, and a missing entry is a
// hard failure rather than a silent fallback to a string in this file.
const registry = JSON.parse(readFileSync(join(root, "sources.json"), "utf8"));
const srcUrl = (id) => {
  const s = (registry.sources ?? []).find((x) => x.id === id);
  if (!s?.url) throw new Error(`sync-data: sources.json has no usable url for "${id}" — the basemap needs it`);
  return s.url;
};

// Tile order differs per provider and getting it backwards yields a plausible map
// in the WRONG PLACE: LandsD is {z}/{x}/{y}, Esri is {z}/{y}/{x}. The order is a
// fact about the provider that cannot be derived from the URL, so it is stated
// per source here — but the PATH is not.
//
// The registry stores a real probed tile (…/14/13387/7151.png) rather than a
// template with braces, because a probe has to request something concrete. So the
// template is derived by replacing the trailing z/x/y integers with tokens, which
// keeps the registry the single source of truth for the path.
function tileTemplate(sampleUrl, order) {
  const m = /\/(\d+)\/(\d+)\/(\d+)(\.[A-Za-z0-9]+)?$/.exec(sampleUrl);
  if (!m) throw new Error(`sync-data: tile sample URL has no /z/x/y tail: ${sampleUrl}`);
  if (order !== "zxy" && order !== "zyx") throw new Error(`sync-data: bad tile order "${order}"`);
  const head = sampleUrl.slice(0, m.index);
  const ext = m[4] ?? "";
  return `${head}/${order === "zxy" ? "{z}/{x}/{y}" : "{z}/{y}/{x}"}${ext}`;
}

const workerBase = (process.env.VITE_WORKER_BASE || "").replace(/\/+$/, "");
// MapLibre substitutes {z}/{x}/{y} AFTER reading the template, so the braces
// must survive URL-encoding: encode the fixed prefix, keep the tokens literal.
const tile = (tpl) =>
  workerBase ? `${workerBase}/proxy?url=${encodeURIComponent(tpl).replace(/%7B/g, "{").replace(/%7D/g, "}")}` : tpl;

// Only LandsD goes through the Worker: its terms forbid request bursts and the
// edge cache is the protection (COST.md §2).
//
// The Esri fallback stays DIRECT, and the earlier reason recorded here — "Esri is
// not in sources.json, so the Worker's whitelist would refuse it" — was WRONG:
// `esri_world_imagery` has been in the registry all along. The real reason is
// cost: it is a FALLBACK that is normally never requested, and spending Worker
// cache entries (and the 100k/day free-tier budget) on a rarely-used layer is the
// wrong trade. Routing it through the Worker is a one-line change if that
// calculation ever flips.
const tileViaWorker = tile;

const LANDSD_TOPO = tileTemplate(srcUrl("landsd_basemap_tiles"), "zxy");
const LANDSD_LABEL = tileTemplate(srcUrl("landsd_label_tiles"), "zxy");
const LANDSD_IMAGERY = tileTemplate(srcUrl("landsd_imagery_tiles"), "zxy");
const ESRI_IMAGERY = tileTemplate(srcUrl("esri_world_imagery"), "zyx");

const style = {
  version: 8,
  name: "hkcm-landsd",
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    "landsd-topo": {
      type: "raster",
      tiles: [tile(LANDSD_TOPO)],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Map from Lands Department 地政總署",
    },
    "landsd-label-tc": {
      type: "raster",
      tiles: [tile(LANDSD_LABEL)],
      tileSize: 256,
      maxzoom: 19,
    },
    // Official aerial imagery — the exact layer LandsD's own 3D-map example
    // uses (mapapi.geodata.gov.hk/xyz/imagery). Keyless when served directly,
    // routed via the Worker's edge cache like the other LandsD tiles.
    "landsd-imagery": {
      type: "raster",
      tiles: [tile(LANDSD_IMAGERY)],
      tileSize: 256,
      maxzoom: 19,
    },
    "esri-imagery": {
      type: "raster",
      tiles: [ESRI_IMAGERY], // direct — see the cost note above
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
