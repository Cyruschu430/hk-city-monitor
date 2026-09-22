// cameras.ts — the video backbone: 1,013 TD traffic cameras + 34 HKO weather
// cameras as clustered points over the basemap. Both lists are PREBUILT JSON
// (scripts/build_cameras.py) so the browser never parses the UTF-16LE double-BOM
// CSV that costs an hour to get wrong (AGENTS.md pitfalls).
//
// TD snapshots are hotlinkable and CORS-open → direct. HKO images are
// CORS-closed → through the Worker proxy. A camera that fails to load shows
// its dead state (暫時未能提供) rather than a black square pretending to be live.

import type maplibregl from "maplibre-gl";
import { proxied } from "../config.ts";
import type { WallImage } from "../lib/render.ts";
import { registerGlyphs } from "./symbols.ts";
import { whenSourceReady } from "./basemap.ts";

export interface Camera {
  id: string;
  name: string;
  district?: string;
  region?: string;
  lat: number;
  lon: number;
  img: string;
  kind: "td" | "hko";
  name_en?: string;
}

export interface CameraLayerOptions {
  onSelect(cam: Camera): void;
}

const TD_SRC = "cameras-td";
const HKO_SRC = "cameras-hko";

/** HKO publishes HD and standard variants; the standard one is ~5× smaller
    and is what a small frame needs. HD stays for the focus drawer. */
export function hkoStandardUrl(img: string): string {
  return img.replace("latest_HD_", "latest_");
}

export function hkoHdUrl(img: string): string {
  return img.includes("latest_HD_") ? img : img.replace(/latest_/, "latest_HD_");
}

export async function loadCameras(): Promise<{ td: Camera[]; hko: Camera[] }> {
  const [td, hko] = await Promise.all([
    fetch("data/cameras_td.json").then((r) => r.json()),
    fetch("data/cameras_hko.json").then((r) => r.json()),
  ]);
  return {
    td: (td as Omit<Camera, "kind">[]).map((c) => ({ ...c, kind: "td" as const })),
    hko: (hko as Omit<Camera, "kind">[]).map((c) => ({ ...c, kind: "hko" as const })),
  };
}

function geojson(cams: Camera[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cams.map((c) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
      properties: { id: c.id, name: c.name, district: c.district ?? "", kind: c.kind },
    })),
  };
}

export function addCameraLayers(map: maplibregl.Map, cameras: { td: Camera[]; hko: Camera[] }, opts: CameraLayerOptions): void {
  // addSource throws "Style is not done loading" if the style has not landed,
  // and isStyleLoaded() is unreliable while sources are fetching — the `load`
  // event is the only honest signal (measured pitfalls, AGENTS.md).
  if (!map.getStyle()) {
    map.once("load", () => addCameraLayers(map, cameras, opts));
    return;
  }
  if (map.getSource(TD_SRC)) return; // already attached

  // Icons must exist in the map's image registry before any symbol layer that
  // references them is added, or MapLibre silently draws nothing.
  registerGlyphs(map);

  const byId = new Map<string, Camera>();
  for (const c of [...cameras.td, ...cameras.hko]) byId.set(c.id, c);

  const add = (id: string, list: Camera[], color: string) => {
    map.addSource(id, {
      type: "geojson",
      data: geojson(list),
      cluster: true,
      clusterRadius: 42,
      clusterMaxZoom: 13,
    });
    map.addLayer({
      id: `${id}-cluster`,
      type: "circle",
      source: id,
      filter: ["has", "point_count"],
      paint: {
        // Restrained bubbles (a screenshot review showed the old 15/21/27/33
        // steps reading as huge overlapping balloons that buried the map).
        // Smaller, denser, thinner stroke — the count carries the meaning.
        "circle-radius": ["step", ["get", "point_count"], 11, 10, 15, 50, 19, 200, 24],
        "circle-color": color,
        "circle-opacity": 0.1,
        "circle-stroke-color": color,
        "circle-stroke-width": 1.1,
        "circle-stroke-opacity": 0.7,
      },
    });
    map.addLayer({
      id: `${id}-count`,
      type: "symbol",
      source: id,
      filter: ["has", "point_count"],
      layout: {
        // demotiles' glyph server has Noto Sans Regular; Open Sans 404s there
        // (measured pitfall — a missing font silently drops the counts).
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["Noto Sans Regular"],
        "text-size": ["step", ["get", "point_count"], 10, 50, 11, 200, 12],
        "text-allow-overlap": true,
      },
      paint: { "text-color": "#dceaff" },
    });
    map.addLayer({
      id: `${id}-point`,
      type: "symbol",
      source: id,
      filter: ["!", ["has", "point_count"]],
      layout: {
        // The camera layer draws CAMERA GLYPHS (drawn at runtime into the map's
        // image registry — see symbols.ts), not anonymous dots: at a glance the
        // map says "traffic/weather camera here".
        "icon-image": id === TD_SRC ? "cam-td" : "cam-hko",
        "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.4, 13, 0.5, 16, 0.62],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-padding": 2,
      },
    });
  };

  add(TD_SRC, cameras.td, "#22d3ee"); // cyan — 運輸署
  add(HKO_SRC, cameras.hko, "#a855f7"); // violet — 天文台

  for (const id of [TD_SRC, HKO_SRC]) {
    map.on("click", `${id}-cluster`, (e) => {
      const f = map.queryRenderedFeatures(e.point, { layers: [`${id}-cluster`] })[0];
      if (!f) return;
      const clusterId = f.properties?.["cluster_id"] as number;
      const src = map.getSource(id) as maplibregl.GeoJSONSource;
      void src.getClusterExpansionZoom(clusterId).then((zoom) => {
        const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        map.easeTo({ center: [lon, lat], zoom, duration: 420 });
      });
    });
    const openAt = (e: maplibregl.MapMouseEvent) => {
      const f = map.queryRenderedFeatures(e.point, { layers: [`${id}-point`] })[0];
      const camId = f?.properties?.["id"] as string | undefined;
      const cam = camId ? byId.get(camId) : undefined;
      if (cam) opts.onSelect(cam);
    };
    map.on("click", `${id}-point`, openAt);
    for (const layer of [`${id}-point`, `${id}-cluster`]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }
  }

  // QA hook: assertions in the browser check these counts, not a screenshot.
  (window as unknown as Record<string, unknown>)["__cameras"] = { td: cameras.td.length, hko: cameras.hko.length };
}

/** The wall shows a small, meaningful set: names that matter in a storm or a
    commute (tunnels, bridges, the harbour, the border) rather than the first
    8 rows of a 1,013-row list. */
export function pickWallCameras(cams: Camera[], n: number): Camera[] {
  const prefer = ["海底隧道", "紅磡", "東區海底隧道", "青馬", "汀九", "昂船洲", "將軍澳", "吐露港", "汀角", "深圳灣", "港珠澳", "獅子山", "大老山", "城門", "中環", "灣仔", "銅鑼灣", "屯門", "元朗", "沙田"];
  const score = (c: Camera) => {
    const i = prefer.findIndex((k) => c.name.includes(k));
    return i === -1 ? 999 : i;
  };
  return [...cams].sort((a, b) => score(a) - score(b)).slice(0, n);
}

export function wallImages(cams: Camera[], useProxy: boolean, fresh?: string): WallImage[] {
  return cams.map((c) => ({
    id: c.id,
    name: c.name,
    src: useProxy ? proxied(hkoStandardUrl(c.img)) : `${c.img}?t=${Math.floor(Date.now() / 60_000)}`,
    fresh,
  }));
}

export function whenCamerasReady(map: maplibregl.Map, fn: () => void): void {
  whenSourceReady(map, TD_SRC, fn);
}

export { TD_SRC, HKO_SRC };
