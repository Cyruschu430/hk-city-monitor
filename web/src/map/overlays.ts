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
import { adaptPanel, type AdapterCtx } from "../lib/adapters.ts";
import { lang } from "../lib/i18n.ts";
import { registerGlyphs } from "./symbols.ts";

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

export interface LayerArgs {
  registry: Registry;
  ctx: AdapterCtx;
  /** districts (Traditional Chinese) that currently have a live suspension */
  activeDistricts?: Set<string>;
  /** mode-switch generation: passed by main; a layer whose fetch outlives the
      mode it was asked for must abort instead of painting orphan geometry */
  gen?: number;
  isCurrent?: (gen: number) => boolean;
}

/** true when this layer request was superseded by a newer mode switch. */
function stale(args: LayerArgs, gen: number): boolean {
  return args.isCurrent !== undefined && !args.isCurrent(gen);
}

function layersOf(def: LayerDefRaw): string[] {
  return [`${PREFIX}${def.id}-fill`, `${PREFIX}${def.id}-line`, `${PREFIX}${def.id}-circle`, `${PREFIX}${def.id}-label`];
}

export function clearVerticalLayers(map: maplibregl.Map, defs: LayerDefRaw[]): void {
  for (const def of defs) {
    for (const id of layersOf(def)) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(`${PREFIX}${def.id}`)) map.removeSource(`${PREFIX}${def.id}`);
  }
}

async function polygonLayer(map: maplibregl.Map, def: LayerDefRaw, args: LayerArgs): Promise<void> {
  const src = args.registry.byId.get(def.source);
  if (!src) throw new Error(`layer ${def.id}: source ${def.source} 唔存在`);
  const gen = args.gen ?? 0;
  const res = await fetch(fetchUrl(src), { signal: AbortSignal.timeout(25_000) });
  if (stale(args, gen)) throw new Error("obsolete layer request"); // mode switched mid-fetch
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as GeoJSON.FeatureCollection;

  const id = `${PREFIX}${def.id}`;
  if (stale(args, gen)) throw new Error("obsolete layer request");
  map.addSource(id, { type: "geojson", data });

  const active = args.activeDistricts ?? new Set<string>();
  const activeList = [...active];
  // No active districts → nothing to say. Drawing 18 faint district outlines
  // anyway turned the map into a violet wireframe (caught in a screenshot
  // review), so the layer is skipped entirely in that case.
  if (activeList.length === 0) return;

  const matchExpr: unknown = ["match", ["get", "DISTRICT_CHINESE"], ...activeList.flatMap((d) => [d, "#ff5d6c"]), "#a855f7"];

  if (stale(args, gen)) throw new Error("obsolete layer request");
  map.addLayer({
    id: `${id}-fill`,
    type: "fill",
    source: id,
    paint: {
      "fill-color": matchExpr as never,
      // 0.22 keeps the district readable while the basemap still shows through
      // (0.30 read as a solid blob in a screenshot review).
      "fill-opacity": ["case", ["in", ["get", "DISTRICT_CHINESE"], ["literal", activeList]], 0.22, 0.03] as never,
    },
  });
  map.addLayer({
    id: `${id}-line`,
    type: "line",
    source: id,
    paint: {
      "line-color": matchExpr as never,
      "line-width": ["case", ["in", ["get", "DISTRICT_CHINESE"], ["literal", activeList]], 2, 0.5] as never,
      "line-opacity": 0.95,
    },
  });
  // District name labels on the ACTIVELY affected areas only — MapLibre draws
  // CJK via localIdeographFontFamily (set in basemap.ts), no glyph server hit.
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
    two camera walls: fetch its GeoJSON and draw it with that glyph. The camera
    walls stay in cameras.ts because they cluster + open a HUD; everything else
    is a plain symbol layer, and the glyph comes from config. */
async function pointLayer(map: maplibregl.Map, def: LayerDefRaw, args: LayerArgs): Promise<void> {
  const src = args.registry.byId.get(def.source);
  if (!src) throw new Error(`layer ${def.id}: source ${def.source} 唔存在`);
  const glyph = def.symbol;
  if (!glyph) throw new Error(`layer ${def.id}: point 圖層需要 symbol 欄位`);
  registerGlyphs(map); // idempotent; the point path may run before cameras.ts

  const gen = args.gen ?? 0;
  const res = await fetch(fetchUrl(src), { signal: AbortSignal.timeout(25_000) });
  if (stale(args, gen)) throw new Error("obsolete layer request");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as GeoJSON.FeatureCollection;

  const id = `${PREFIX}${def.id}`;
  if (stale(args, gen)) throw new Error("obsolete layer request");
  map.addSource(id, { type: "geojson", data, cluster: true, clusterRadius: 46, clusterMaxZoom: 13 });

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
