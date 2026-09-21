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

const PREFIX = "vl-";

export interface LayerArgs {
  registry: Registry;
  ctx: AdapterCtx;
  /** districts (Traditional Chinese) that currently have a live suspension */
  activeDistricts?: Set<string>;
}

function layersOf(def: LayerDefRaw): string[] {
  return [`${PREFIX}${def.id}-fill`, `${PREFIX}${def.id}-line`, `${PREFIX}${def.id}-circle`];
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
  const res = await fetch(fetchUrl(src), { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as GeoJSON.FeatureCollection;

  const id = `${PREFIX}${def.id}`;
  map.addSource(id, { type: "geojson", data });

  const active = args.activeDistricts ?? new Set<string>();
  const activeList = [...active];
  // Districts with a live suspension are the story; the rest are context.
  // A `match` expression needs at least one label/value pair plus a fallback —
  // with no active districts there is nothing to match, so use a plain colour
  // (MapLibre rejects `["match", input, fallback]` outright).
  const matchExpr: unknown = activeList.length
    ? ["match", ["get", "DISTRICT_CHINESE"], ...activeList.flatMap((d) => [d, "#ff5d6c"]), "#a855f7"]
    : "#a855f7";

  map.addLayer({
    id: `${id}-fill`,
    type: "fill",
    source: id,
    paint: {
      "fill-color": matchExpr as never,
      "fill-opacity": (activeList.length
        ? ["case", ["in", ["get", "DISTRICT_CHINESE"], ["literal", activeList]], 0.22, 0.07]
        : 0.07) as never,
    },
  });
  map.addLayer({
    id: `${id}-line`,
    type: "line",
    source: id,
    paint: {
      "line-color": matchExpr as never,
      "line-width": (activeList.length
        ? ["case", ["in", ["get", "DISTRICT_CHINESE"], ["literal", activeList]], 1.6, 0.8]
        : 0.8) as never,
      "line-opacity": 0.85,
    },
  });

  map.on("click", `${id}-fill`, (e) => {
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
  const { data } = await adaptPanel(panel, args.ctx);
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

/** Apply a vertical's layers. Returns the ids actually drawn (for QA). */
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
          // Camera sources are drawn by cameras.ts; a vertical only asserts them.
          const prefix = def.source.includes("hko") ? "cameras-hko" : "cameras-td";
          for (const suffix of ["cluster", "count", "point"]) {
            if (map.getLayer(`${prefix}-${suffix}`)) map.setLayoutProperty(`${prefix}-${suffix}`, "visibility", "visible");
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
