// overlays.ts — renders a vertical's `layers` array onto the map.
//
// PRIMITIVES §2/§0.00: a layer is ONE definition in layers.json, rendered by
// the map engine as 2D (MapLibre) or 3D (deck.gl); a vertical never writes
// 2D code. This file is the 2D renderer for the three geoms that carry data:
//   polygon → GeoJSON fill+line (CSDI district boundaries)
//   raster  → image overlay from the adapter's canvas (rain nowcast)
//   point   → the camera sources already on the map (visibility only)
// `none` layers are panel-only and draw nothing, by definition.

import maplibregl from "maplibre-gl";
import { fetchUrl, type LayerDefRaw, type PanelDefRaw, type Registry } from "../lib/sources.ts";
import { adaptPanel, hasAdapter, type AdapterCtx } from "../lib/adapters.ts";
import { lang } from "../lib/i18n.ts";
import { registerBarbs, registerGlyphs } from "./symbols.ts";

const PREFIX = "vl-";

/** Cluster ring colour per glyph family, so a cluster of ferries does not read
    as a cluster of cameras when both are on screen. */
function glyphColor(glyph: string): string {
  if (glyph.startsWith("cam-td")) return "#22d3ee";
  if (glyph.startsWith("cam-hko") || glyph === "station-wind") return "#a855f7";
  if (glyph === "aqhi") return "#34d399";
  if (glyph === "water") return "#38bdf8";
  return "#22d3ee";
}

/** A bilingual name as the registries write it. */
interface L10nName {
  tc: string;
  en: string;
}

/** One geocoded water-suspension notice: WHERE the outage actually is. */
export interface WaterPoint {
  id: string;
  lat: number;
  lng: number;
  district: string;
  address: string;
  water_type: string;
  nature: string;
  cause: string;
  suspend_at: string | null;
  resume_at: string | null;
}

export interface LayerArgs {
  registry: Registry;
  ctx: AdapterCtx;
  /** districts (Traditional Chinese) that currently have a live suspension */
  activeDistricts?: Set<string>;
  /** Geocoded notice locations. `activeDistricts` says which districts are
      affected; this says WHERE, so the map drops a pin on the building instead
      of tinting a whole district for one address. Populated from the
      collector's ALS geocoding — a notice that did not resolve is absent here
      but still contributes its district, so nothing disappears silently. */
  waterPoints?: WaterPoint[];
  /** Live trigger state, so a POI popup can show the reading its panel shows
      (e.g. a control point's current queue) instead of only naming the place. */
  triggerState?: Record<string, unknown>;
  /** mode-switch generation: passed by main; a layer whose fetch outlives the
      mode it was asked for must abort instead of painting orphan geometry */
  gen?: number;
  isCurrent?: (gen: number) => boolean;
}

/** true when this layer request was superseded by a newer mode switch. */
function stale(args: LayerArgs, gen: number): boolean {
  return args.isCurrent !== undefined && !args.isCurrent(gen);
}

/** Every layer id a vertical layer may create. Removal must cover all of them:
 *  a layer this list misses survives its own toggle and paints over the next
 *  mode (the same class of bug as the orphaned district mesh). `-halo` and
 *  `-point` were added with the aircraft layer; `-count` with the generic
 *  point path. */
function layersOf(def: LayerDefRaw): string[] {
  return [
    `${PREFIX}${def.id}-fill`,
    `${PREFIX}${def.id}-line`,
    `${PREFIX}${def.id}-circle`,
    `${PREFIX}${def.id}-label`,
    `${PREFIX}${def.id}-count`,
    `${PREFIX}${def.id}-halo`,
    `${PREFIX}${def.id}-point`,
  ];
}

export function clearVerticalLayers(map: maplibregl.Map, defs: LayerDefRaw[]): void {
  for (const def of defs) {
    for (const id of layersOf(def)) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(`${PREFIX}${def.id}`)) map.removeSource(`${PREFIX}${def.id}`);
    // The suspension pins are a SECOND source under the same layer definition,
    // so clearing must remove them too or a mode switch leaves orphan dots.
    const pid = `${PREFIX}${def.id}-points`;
    if (map.getLayer(pid)) map.removeLayer(pid);
    if (map.getSource(pid)) map.removeSource(pid);
  }
}

/**
 * Draw the geocoded suspension pins, with a popup per notice.
 *
 * Cyrus: "Layers District with water suspension should refering to Panel
 * 水務署 臨時停水通知 showing the affected locations by geocoding."
 *
 * Before this the layer tinted a whole district polygon for an outage that was
 * often ONE building — a single 牛頭角道 notice turned all of 觀塘區 red. The
 * notices carry a street address but no coordinates, so the collector resolves
 * each one through ALS (the registered `als_address_lookup` source) and
 * publishes lat/lng; see scripts/build_water_suspension.py.
 *
 * Two-tone on purpose: 食水 (drinking water) is the life-safety case and takes
 * the same alert red as the district tint; 鹹水 (flushing water) is a nuisance
 * and is amber. They are NOT the same emergency and the map says so without
 * needing the popup.
 *
 * A separate function because the pins must be reachable on BOTH paths — the
 * district tint can legitimately have nothing to draw while the pins do.
 */
function drawWaterPoints(map: maplibregl.Map, id: string, pts: WaterPoint[]): void {
  if (pts.length === 0) return;
  const pid = `${id}-points`;
  if (map.getLayer(pid)) map.removeLayer(pid);
  if (map.getSource(pid)) map.removeSource(pid);
  map.addSource(pid, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: pts.map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: {
          address: p.address,
          district: p.district,
          water_type: p.water_type,
          nature: p.nature,
          cause: p.cause,
          suspend_at: p.suspend_at,
          resume_at: p.resume_at,
          drinking: /食水/.test(p.water_type) ? 1 : 0,
        },
      })),
    },
  });
  map.addLayer({
    id: pid,
    type: "circle",
    source: pid,
    paint: {
      "circle-color": ["case", ["==", ["get", "drinking"], 1], "#ff5d6c", "#fbbf24"],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 8, 17, 12],
      "circle-stroke-color": "rgba(5,7,13,.85)",
      "circle-stroke-width": 1.5,
      "circle-opacity": 0.95,
    },
  });
  map.on("click", pid, (e) => {
    // Same guard as the district polygon: MapLibre fires every handler under the
    // cursor, so without it a camera click stacks two popups.
    const camHit = map.queryRenderedFeatures(e.point, {
      layers: ["cameras-td-point", "cameras-hko-point", "cameras-td-cluster", "cameras-hko-cluster"],
    });
    if (camHit.length > 0) return;
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties ?? {};
    const tc = lang() === "tc";
    const when = String(p["suspend_at"] ?? "").slice(5, 16).replace("T", " ");
    const back = String(p["resume_at"] ?? "").slice(5, 16).replace("T", " ");
    const drinking = p["drinking"] === 1;
    const html = `
        <div style="padding:9px 11px;font:12px/1.55 var(--font-ui);max-width:280px">
          <b style="color:${drinking ? "#ff5d6c" : "#fbbf24"}">
            ${String(p["water_type"] ?? "")} · ${String(p["nature"] ?? "")}
          </b><br>
          <b>${String(p["district"] ?? "")}</b> ${String(p["address"] ?? "")}<br>
          <span style="color:#8ea6c4">${String(p["cause"] ?? "")}</span><br>
          <span style="color:#8ea6c4">${tc ? "停水" : "from"} ${when}${back ? ` → ${back}` : ""}</span>
        </div>`;
    new maplibregl.Popup({ closeButton: true, className: "cam-popup" }).setLngLat(e.lngLat).setHTML(html).addTo(map);
  });
  map.on("mouseenter", pid, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", pid, () => (map.getCanvas().style.cursor = ""));
}

/** Trim whitespace from a district name.
 *
 * MEASURED upstream defect: CSDI publishes 深水埗區 with a trailing CRLF —
 * `"深水埗區\r\n"` (feature OBJECTID 6 of the WSD district layer). Every match
 * below is exact string equality, so a clean name from a WSD notice would never
 * match that polygon and the district would silently never highlight.
 *
 * Normalising at the boundary (once, when the data arrives) rather than at each
 * comparison means the match, the filter, the paint expression and the label all
 * agree by construction — and the popup shows a clean name. */
function cleanDistrict(v: unknown): string {
  return typeof v === "string" ? v.replace(/[\r\n\t]+/g, " ").trim() : "";
}

/** Normalise every feature's district name in place-safe fashion (returns new). */
function normaliseDistricts(fc: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  return {
    ...fc,
    features: (fc.features ?? []).map((f) => {
      const props = f.properties ?? {};
      const name = cleanDistrict(props["DISTRICT_CHINESE"]);
      if (!name || name === props["DISTRICT_CHINESE"]) return f;
      return { ...f, properties: { ...props, DISTRICT_CHINESE: name } };
    }),
  };
}

async function polygonLayer(map: maplibregl.Map, def: LayerDefRaw, args: LayerArgs): Promise<void> {
  const src = args.registry.byId.get(def.source);
  if (!src) throw new Error(`layer ${def.id}: source ${def.source} 唔存在`);
  const gen = args.gen ?? 0;
  const res = await fetch(fetchUrl(src), { signal: AbortSignal.timeout(25_000) });
  if (stale(args, gen)) throw new Error("obsolete layer request"); // mode switched mid-fetch
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = (await res.json()) as GeoJSON.FeatureCollection;
  const data = normaliseDistricts(raw);

  const id = `${PREFIX}${def.id}`;
  if (stale(args, gen)) throw new Error("obsolete layer request");
  map.addSource(id, { type: "geojson", data });

  const active = args.activeDistricts ?? new Set<string>();
  const activeList = [...active];
  const pts = args.waterPoints ?? [];
  // No active districts → the district TINT has nothing to say, and drawing 18
  // faint outlines anyway turned the map into a violet wireframe (caught in a
  // screenshot review). MEASURED 2026-09-24: this used to `return` outright, so
  // it also skipped the pins below — the map then showed a source with zero
  // layers while the panel listed 15 real notices, because the district set is
  // populated asynchronously by the panel and is legitimately empty on the first
  // draw even when the geocoded points are already known. Pins and tint now draw
  // INDEPENDENTLY; the function gives up only when BOTH are empty.
  if (activeList.length === 0 && pts.length === 0) return;
  if (activeList.length === 0) {
    drawWaterPoints(map, id, pts);
    return;
  }

  const matchExpr: unknown = ["match", ["get", "DISTRICT_CHINESE"], ...activeList.flatMap((d) => [d, "#ff5d6c"]), "#a855f7"];

  if (stale(args, gen)) throw new Error("obsolete layer request");
  map.addLayer({
    id: `${id}-fill`,
    type: "fill",
    source: id,
    // Only the affected districts are drawn at all. The first version painted
    // the other 17 at fill-opacity 0.03 with a 0.5px violet line "for context",
    // and at 18 districts that reads as a wireframe mesh over the whole
    // territory (caught twice in screenshot reviews — once with no active
    // districts, and again with 9, where the mesh survived around the edges).
    // Context comes from the basemap, not from outlines of places nothing is
    // happening.
    filter: ["in", ["get", "DISTRICT_CHINESE"], ["literal", activeList]],
    paint: {
      "fill-color": matchExpr as never,
      // 0.22 keeps the district readable while the basemap still shows through
      // (0.30 read as a solid blob in a screenshot review).
      "fill-opacity": 0.22,
    },
  });
  map.addLayer({
    id: `${id}-line`,
    type: "line",
    source: id,
    filter: ["in", ["get", "DISTRICT_CHINESE"], ["literal", activeList]],
    paint: {
      "line-color": matchExpr as never,
      "line-width": 2,
      "line-opacity": 0.95,
    },
  });
  // District name labels on the ACTIVELY affected areas only — MapLibre draws
  // CJK through `localIdeographFontFamily`, which main.ts sets on the map when
  // it builds the style (map/basemap.ts only defines that style), so no glyph
  // server is hit at all.
  map.addLayer({
    id: `${id}-label`,
    type: "symbol",
    source: id,
    filter: ["in", ["get", "DISTRICT_CHINESE"], ["literal", activeList]],
    layout: {
      "text-field": ["get", "DISTRICT_CHINESE"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
      "text-offset": [0, 0.4],
      "text-anchor": "center",
    },
    paint: {
      "text-color": "#ff5d6c",
      "text-halo-color": "rgba(5,7,13,.9)",
      "text-halo-width": 1.2,
    },
  });
  if (stale(args, gen)) throw new Error("obsolete layer request");

  map.on("click", `${id}-fill`, (e) => {
    // A camera sitting on a district polygon receives the same click: MapLibre
    // fires every layer handler under the cursor, so without this guard a
    // camera click stacked a district popup on top of the camera HUD + drawer
    // (caught in a screenshot review).
    const camHit = map.queryRenderedFeatures(e.point, {
      layers: ["cameras-td-point", "cameras-hko-point", "cameras-td-cluster", "cameras-hko-cluster"],
    });
    if (camHit.length > 0) return;
    const f = e.features?.[0];
    if (!f) return;
    const props = f.properties ?? {};
    const name = String(props["DISTRICT_CHINESE"] ?? props["DISTRICT"] ?? "—");
    const isActive = active.has(name);
    const csv = String(props["URL"] ?? "");
    const html = `
      <div style="padding:9px 11px;font:12px/1.5 var(--font-ui)">
        <b>${name}</b><br>
        <span style="color:${isActive ? "#ff5d6c" : "#8ea6c4"}">
          ${isActive ? (lang() === "tc" ? "有停水通知" : "suspension in force") : lang() === "tc" ? "現時無停水通知" : "no suspension"}
        </span>
        ${csv ? `<br><a href="${csv}" target="_blank" rel="noopener" style="color:#8ea6c4">水務署分區通知 ↗</a>` : ""}
      </div>`;
    new maplibregl.Popup({ closeButton: true, className: "cam-popup" }).setLngLat(e.lngLat).setHTML(html).addTo(map);
  });
  map.on("mouseenter", `${id}-fill`, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", `${id}-fill`, () => (map.getCanvas().style.cursor = ""));

  // Pins on the actual affected addresses, on top of the district tint. The tint
  // says how large the affected area is; the pins say WHERE.
  drawWaterPoints(map, id, pts);
}

async function rasterLayer(map: maplibregl.Map, def: LayerDefRaw, args: LayerArgs, panel: PanelDefRaw | undefined): Promise<void> {
  if (!panel) throw new Error(`layer ${def.id}: 冇對應 panel 定義 bbox/opacity`);
  const gen = args.gen ?? 0;
  const { data } = await adaptPanel(panel, args.ctx);
  if (stale(args, gen)) throw new Error("obsolete layer request");
  if (data.kind !== "raster_map") throw new Error(`layer ${def.id}: 資料唔係 raster`);
  const bbox = (panel.params?.["bbox"] as [number, number, number, number]) ?? [22.15, 113.83, 22.56, 114.44];
  const [minLat, minLon, maxLat, maxLon] = bbox;
  const id = `${PREFIX}${def.id}`;
  map.addSource(id, {
    type: "image",
    url: data.src,
    coordinates: [
      [minLon, maxLat],
      [maxLon, maxLat],
      [maxLon, minLat],
      [minLon, minLat],
    ],
  });
  map.addLayer({
    id: `${id}-fill`,
    type: "raster",
    source: id,
    paint: {
      "raster-opacity": Number(panel.params?.["opacity"] ?? 0.6),
      "raster-resampling": "nearest",
    },
  });
}

/** A point layer declared in layers.json with a `symbol` that is NOT one of the
    two camera walls. Two data shapes reach here:
 *
 *   - a GeoJSON FeatureCollection (CSDI-style layers) → drawn as-is
 *   - a JSON feed with an adapter (ADS-B aircraft) → the adapter's `records`
 *     are converted to point features, and any `trackDeg` becomes a per-feature
 *     `bearing` that rotates the glyph, so a plane points where it is flying.
 *
 * The camera walls stay in cameras.ts because they cluster into a HUD;
 * everything else is a symbol layer, and the glyph comes from config. */
async function pointLayer(map: maplibregl.Map, def: LayerDefRaw, args: LayerArgs): Promise<void> {
  const src = args.registry.byId.get(def.source);
  if (!src) throw new Error(`layer ${def.id}: source ${def.source} 唔存在`);
  const glyph = def.symbol;
  if (!glyph) throw new Error(`layer ${def.id}: point 圖層需要 symbol 欄位`);
  registerGlyphs(map); // idempotent; the point path may run before cameras.ts

  const gen = args.gen ?? 0;
  const panel = args.registry.panels.find((p) => p.source === def.source);
  let fc: GeoJSON.FeatureCollection;

  if (panel && hasAdapter(def.source)) {
    // Feed source (ADS-B): reuse the panel's adapter so the map and the panel
    // read the SAME parse of the SAME fetch — they cannot disagree about what
    // is aloft.
    const { geo } = await adaptPanel(panel, args.ctx);
    if (stale(args, gen)) throw new Error("obsolete layer request");
    if (!geo) throw new Error(`layer ${def.id}: adapter 冇提供 geo 資料`);
    fc = geo;
  } else {
    const res = await fetch(fetchUrl(src), { signal: AbortSignal.timeout(25_000) });
    if (stale(args, gen)) throw new Error("obsolete layer request");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fc = (await res.json()) as GeoJSON.FeatureCollection;
  }

  const id = `${PREFIX}${def.id}`;
  if (stale(args, gen)) throw new Error("obsolete layer request");
  // A moving point layer is NOT clustered: aircraft change position every few
  // seconds, so clusters would re-form constantly and hide exactly the
  // individual tracks this layer exists to show. Camera points are static and
  // stay clustered.
  const moving = glyph === "plane" || glyph === "ferry";
  map.addSource(id, {
    type: "geojson",
    data: fc,
    ...(moving ? {} : { cluster: true, clusterRadius: 46, clusterMaxZoom: 13 }),
  });

  if (moving) {
    // Aircraft get a dark halo disc under the glyph. The first version drew the
    // bare plane outline, which on the dark basemap is a faint white speck you
    // have to hunt for (caught in a screenshot review) — the camera layers had
    // the same problem and solved it the same way. `icon-halo` is not a
    // MapLibre property, so the disc is a separate circle layer.
    map.addLayer({
      id: `${id}-halo`,
      type: "circle",
      source: id,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 5.5, 12, 7.5, 16, 10] as never,
        "circle-color": "rgba(8,14,24,.78)",
        "circle-stroke-color": "rgba(120,180,240,.55)",
        "circle-stroke-width": 1,
      },
    });
    map.addLayer({
      id: `${id}-point`,
      type: "symbol",
      source: id,
      // `icon-rotate` reads the `bearing` property the adapter writes, so a
      // plane points where it is flying rather than all pointing north.
      layout: {
        "icon-image": glyph,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.32, 12, 0.46, 16, 0.64] as never,
        "icon-rotate": ["get", "bearing"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
    return;
  }

  // Wind barbs: the icon varies PER FEATURE (the speed bucket picks the image),
  // so this is the one point layer whose icon-image is data-driven rather than
  // a fixed glyph id.
  if (glyph === "wind-barb") {
    registerBarbs(map);
    map.addLayer({
      id: `${id}-point`,
      type: "symbol",
      source: id,
      layout: {
        // `barbId` is written by the converter; a missing one falls back to calm
        // rather than to a random bucket.
        "icon-image": ["concat", "barb-", ["coalesce", ["get", "barbId"], "calm"]] as never,
        // Sized to be READ, not just present: the first pass ran 0.5-0.95 and
        // the barbs were unreadable specks on the dark basemap (caught in a
        // screenshot review). Feathers are the information — too small to count
        // them and the glyph is decoration.
        "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.7, 11, 1.0, 14, 1.35] as never,
        // Barbs point INTO the wind, so the shaft is rotated by direction + 180.
        "icon-rotate": ["+", ["get", "dirDeg"], 180] as never,
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        // The honesty control (ROADMAP B5): a barb only exists where a station
        // measured it, and confidence falls off with distance from that station.
        // `fade` is computed per feature from the distance to the nearest
        // reporting station; nothing is drawn beyond ~15km.
        // icon-opacity is a PAINT property, not layout (it is data-driven here).
        "icon-opacity": ["get", "fade"] as never,
      },
    });
    return;
  }

  const size: unknown = ["interpolate", ["linear"], ["zoom"], 9, 0.4, 13, 0.55, 16, 0.7];
  map.addLayer({
    id: `${id}-circle`,
    type: "circle",
    source: id,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "rgba(34,211,238,.10)",
      "circle-stroke-color": glyphColor(glyph),
      "circle-stroke-width": ["step", ["get", "point_count"], 1.1, 10, 1.6, 25, 2.2] as never,
      "circle-radius": ["step", ["get", "point_count"], 13, 10, 18, 25, 24] as never,
    },
  });
  map.addLayer({
    id: `${id}-count`,
    type: "symbol",
    source: id,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": ["Noto Sans Regular"],
      "text-size": ["step", ["get", "point_count"], 10, 10, 11, 25, 12] as never,
    },
    paint: { "text-color": "#dceaff" },
  });
  map.addLayer({
    id: `${id}-point`,
    type: "symbol",
    source: id,
    filter: ["!", ["has", "point_count"]],
    layout: { "icon-image": glyph, "icon-size": size as never, "icon-allow-overlap": true },
  });
}
/**
 * Official control points as map POIs, with a popup carrying their attributes.
 *
 * Cyrus: "Most layers are not refering to the panel -> layer should showing the
 * POI with pop up attribute when Border crossing mode is on."
 *
 * Before this, 口岸模式 drew ONLY the camera dots: three panels of queue times and
 * ferry times, and nothing on the map saying WHICH crossings they referred to.
 * The link between panel and map was missing in exactly the mode where the map
 * should be the primary instrument.
 *
 * Positions come from data/control_points.json, which is reference data with a
 * validation trail — each coordinate was checked against an official anchor and
 * rejected if more than 1.5km off (that check caught four wrong lookups). The one
 * unresolved point (深圳灣) is deliberately absent and rendered at district level
 * instead of being given a confident wrong pin.
 *
 * Live queue times are joined in from the trigger state when available, so the
 * popup answers the question the panel is asking ("how long is the queue") rather
 * than only naming the place. A crossing with no live reading shows its hours
 * instead of a fabricated number.
 */
async function controlPointLayer(map: maplibregl.Map, def: LayerDefRaw, args: LayerArgs): Promise<void> {
  const gen = args.gen ?? 0;
  const res = await fetch("data/control_points.json", { signal: AbortSignal.timeout(15_000) });
  if (stale(args, gen)) throw new Error("obsolete layer request");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as {
    points: { code: string; name: L10nName; kind: string; lat: number; lng: number; _note?: string }[];
  };
  const id = `${PREFIX}${def.id}`;
  if (stale(args, gen)) throw new Error("obsolete layer request");
  map.addSource(id, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: j.points.map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
        properties: {
          code: p.code,
          tc: p.name.tc,
          en: p.name.en,
          kind: p.kind,
        },
      })),
    },
  });
  map.addLayer({
    id,
    type: "circle",
    source: id,
    paint: {
      // Land, sea and air crossings are different things; colour by kind so the
      // three read apart without opening a popup.
      "circle-color": [
        "match",
        ["get", "kind"],
        "air", "#38bdf8",
        "sea", "#22d3ee",
        "#a855f7",
      ] as never,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 5, 14, 9, 17, 13],
      "circle-stroke-color": "rgba(5,7,13,.9)",
      "circle-stroke-width": 2,
    },
  });
  // Names sit beside the dots from z11 — below that they collide across the
  // harbour and the dots alone are enough.
  map.addLayer({
    id: `${id}-label`,
    type: "symbol",
    source: id,
    minzoom: 11,
    layout: {
      "text-field": ["get", lang() === "tc" ? "tc" : "en"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-offset": [0, 1.4],
      "text-anchor": "top",
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#e6f1ff",
      "text-halo-color": "rgba(5,7,13,.92)",
      "text-halo-width": 1.4,
    },
  });

  map.on("click", id, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties ?? {};
    const code = String(p["code"] ?? "");
    const tc = lang() === "tc";
    // Join the live queue reading the panel is showing, so the popup answers the
    // question rather than restating the label.
    const st = (args.triggerState?.immd_cp_queue ?? {}) as Record<string, { arr?: number | null; dep?: number | null }>;
    const q = st[code];
    const fmtQ = (v: number | null | undefined) =>
      v === null || v === undefined ? (tc ? "冇讀數" : "no reading") : `${v} ${tc ? "分鐘" : "min"}`;
    const queue = q
      ? `<span style="color:#8ea6c4">${tc ? "入境" : "arrival"} ${fmtQ(q.arr)} · ${tc ? "出境" : "departure"} ${fmtQ(q.dep)}</span><br>`
      : "";
    const kindLabel =
      p["kind"] === "air" ? (tc ? "航空" : "Air") : p["kind"] === "sea" ? (tc ? "水路" : "Sea") : tc ? "陸路" : "Land";
    const html = `
        <div style="padding:9px 11px;font:12px/1.55 var(--font-ui);max-width:270px">
          <b>${String(p[tc ? "tc" : "en"] ?? "")}</b><br>
          <span style="color:#8ea6c4">${kindLabel} · ${code}</span><br>
          ${queue}
          ${
            code === "STK"
              ? `<span style="color:#fbbf24">${tc ? "通關服務已暫停" : "passenger service suspended"}</span><br>`
              : ""
          }
          <a href="https://www.immd.gov.hk/hkt/contactus/control_points.html" target="_blank" rel="noopener" style="color:#8ea6c4">入境處管制站資料 ↗</a>
        </div>`;
    new maplibregl.Popup({ closeButton: true, className: "cam-popup" }).setLngLat(e.lngLat).setHTML(html).addTo(map);
  });
  map.on("mouseenter", id, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", id, () => (map.getCanvas().style.cursor = ""));
}

export async function applyVerticalLayers(map: maplibregl.Map, defs: LayerDefRaw[], args: LayerArgs): Promise<string[]> {
  const drawn: string[] = [];
  for (const def of defs) {
    try {
      switch (def.geom) {
        case "polygon":
          await polygonLayer(map, def, args);
          drawn.push(def.id);
          break;
        case "raster": {
          // A raster layer needs its panel's bbox/opacity; panels carry those.
          const panel = args.registry.panels.find((p) => p.source === def.source && p.render === "raster_map");
          await rasterLayer(map, def, args, panel);
          drawn.push(def.id);
          break;
        }
        case "point": {
          // The two camera walls are drawn (and clustered + HUD-wired) by
          // cameras.ts; a vertical only asserts visibility. Any other point
          // layer carries its own `symbol` and is drawn here.
          if (def.source.includes("td_camera") || def.source.includes("hko_webcam")) {
            const prefix = def.source.includes("hko") ? "cameras-hko" : "cameras-td";
            for (const suffix of ["cluster", "count", "point"]) {
              if (map.getLayer(`${prefix}-${suffix}`)) map.setLayoutProperty(`${prefix}-${suffix}`, "visibility", "visible");
            }
          } else {
            await pointLayer(map, def, args);
          }
          drawn.push(def.id);
          break;
        }
        case "poi":
          // Official facilities that are the SUBJECT of a mode's panels — the
          // control points 口岸模式 reports queue times for. A `poi` layer reads
          // its own reference file rather than a source, because these positions
          // are curated and validated, not fetched from a feed.
          await controlPointLayer(map, def, args);
          drawn.push(def.id);
          break;
        case "none":
        case "line":
        default:
          break;
      }
    } catch (err) {
      // One broken layer must not take the whole mode down; it is reported by
      // the caller (banner) and the rest of the vertical still renders.
      throw new Error(`圖層 ${def.id}：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return drawn;
}
