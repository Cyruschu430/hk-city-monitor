// basemap.ts — MapLibre GL with the Lands Department XYZ basemap.
//
// Two measured pitfalls this file exists to respect:
//   1. MapLibre 4.7.x silently ignores an INLINE style object (black map, no
//      error, `load` never fires) — the style is always a URL. sync-data.mjs
//      generates public/basemap/style.json and may route tiles via the Worker.
//   2. `<div id="map">` becomes a global `window.map`, shadowing anything
//      named `map` — the instance is exposed explicitly as window.__map for QA.
//
// Attribution is a LICENCE TERM, not a footnote: the Lands Department logo
// badge plus "Map from Lands Department" sits on the map face at all times.

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { HK_CENTER, HK_ZOOM } from "../config.ts";
import { h } from "../lib/dom.ts";

export const LANDSD_URL = "https://www.landsd.gov.hk/";
export const STYLE_URL = "basemap/style.json";

export function createMap(container: HTMLElement): maplibregl.Map {
  const map = new maplibregl.Map({
    container,
    style: STYLE_URL,
    center: HK_CENTER,
    zoom: HK_ZOOM,
    minZoom: 8,
    maxZoom: 18,
    attributionControl: false,
    // The dark treatment is a paint property in style.json, not a CSS filter:
    // filters would also darken the camera layers drawn above the basemap.
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(
    new maplibregl.AttributionControl({ compact: true, customAttribution: "Map from Lands Department 地政總署" }),
    "bottom-right",
  );
  return map;
}

/** The always-visible LandsD badge (licence term). */
export function landsdBadge(): HTMLElement {
  return h(
    "div",
    { class: "landsd-badge" },
    h(
      "a",
      { href: LANDSD_URL, target: "_blank", rel: "noopener", title: "地政總署 Lands Department" },
      "Map from Lands Department",
    ),
    h("span", {}, "地政總署"),
  );
}

export function setBasemap(map: maplibregl.Map, kind: "topo" | "imagery"): void {
  if (!map.getLayer("landsd-topo") || !map.getLayer("esri-imagery")) return;
  map.setLayoutProperty("landsd-topo", "visibility", kind === "topo" ? "visible" : "none");
  map.setLayoutProperty("esri-imagery", "visibility", kind === "imagery" ? "visible" : "none");
  // Labels are designed for the topographic map; on imagery they are noise.
  map.setLayoutProperty("landsd-label-tc", "visibility", kind === "topo" ? "visible" : "none");
}

/** Attach layers only once their source exists. `isStyleLoaded()` stays false
    while ANY source is still fetching, so gating on it attaches too late —
    gate on the source instead (measured pitfall). */
export function whenSourceReady(map: maplibregl.Map, sourceId: string, fn: () => void): void {
  const run = () => {
    if (map.getSource(sourceId)) fn();
  };
  if (map.getSource(sourceId)) {
    fn();
    return;
  }
  map.on("sourcedata", (e) => {
    if (e.sourceId === sourceId && e.isSourceLoaded !== false) run();
  });
  map.on("load", run);
}
