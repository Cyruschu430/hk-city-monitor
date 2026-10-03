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
import { lang, onLangChange } from "../lib/i18n.ts";

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
    // Render CJK glyphs from LOCAL fonts instead of pulling them from a glyph
    // server (the free demotiles server only ships Latin). This is what lets a
    // map-side symbol layer show 停水區名 without a new font dependency.
    localIdeographFontFamily: '"PingFang HK", "Noto Sans TC", "Microsoft JhengHei", sans-serif',
    // The dark treatment is a paint property in style.json, not a CSS filter:
    // filters would also darken the camera layers drawn above the basemap.
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(
    new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }),
    "bottom-left",
  );
  map.addControl(
    // The LAND are done by the badge below; the IMAGERY is Esri's, and Esri requires its own
    // credit: "Esri attribution is the requirement to display 'Powered by Esri' text in all
    // applications that use Esri technology including ... content, or services", positioned at
    // the bottom-right of the main application and linked to esri.com (developers.arcgis.com,
    // read 2026-10-02). The World Imagery credit string is the service's own. The LandsD text
    // that used to be here stays removed: it repeated the badge, and a duplicate in the same
    // corner is a defect, not extra credit.
    new maplibregl.AttributionControl({
      compact: true,
      customAttribution:
        'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a>' +
        " · Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    }),
    "bottom-right",
  );
  return map;
}

/**
 * The always-visible LandsD attribution (licence term).
 *
 * Cyrus asked on 2026-10-02 whether this could go, since the map already credits Esri. It cannot -
 * the terms are explicit and the Esri credit does not stand in for them. The LandsD Map API
 * disclaimer and the CSDI API docs both say: "You are required to include Lands Department logo on
 * the map face and Copyright Notice to attribute Lands Department's data in your map applications."
 * The notice wording is prescribed too - "Map from Lands Department" / "地圖由地政總署提供".
 *
 * What the reading turned up as well: we had the notice but NOT the logo, so this badge was
 * under-compliant the whole time. The logo is now the official file, committed under
 * web/public/brand/ (its whole purpose is to be displayed for attribution). Styling is deliberately
 * bare - no background, no border - so it reads as a quiet corner line rather than a panel, which is
 * what Cyrus was actually objecting to.
 */
export function landsdBadge(): HTMLElement {
  // Logo + ONE notice line (Cyrus 2026-10-03): the badge used to show the notice in BOTH
  // languages at once, which read as three redundant credits. The licence requires the logo
  // and the prescribed wording — one language is enough, and it follows the UI language.
  const badge = h("div", { class: "landsd-badge" });
  const render = () =>
    badge.replaceChildren(
      h("img", {
        class: "landsd-logo",
        src: "/brand/landsd-logo.png",
        alt: "地政總署 Lands Department",
      }),
      h(
        "a",
        { href: LANDSD_URL, target: "_blank", rel: "noopener", title: "地政總署 Lands Department" },
        lang() === "tc" ? "地圖由地政總署提供" : "Map from Lands Department",
      ),
    );
  render();
  onLangChange(render);
  return badge;
}

export type BasemapKind = "topo" | "imagery" | "esri-topo" | "esri-gray";

// One table, four kinds: each basemap is a raster layer visible only when it is the chosen one, so a
// fifth is a row here plus a source and layer in style.json - not another branch. LandsD topographic
// is the default; the Esri pair are the additions Cyrus asked for (2026-10-02), both keyless.
const BASEMAP_LAYERS: Record<BasemapKind, string> = {
  topo: "landsd-topo",
  imagery: "landsd-imagery",
  "esri-topo": "esri-topo",
  "esri-gray": "esri-gray",
};

export function setBasemap(map: maplibregl.Map, kind: BasemapKind): void {
  if (!map.getLayer("landsd-topo")) return;
  for (const [k, layer] of Object.entries(BASEMAP_LAYERS)) {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, "visibility", k === kind ? "visible" : "none");
  }
  // Esri World Imagery stays the fallback it has always been: never a UI option, so it is switched
  // off alongside everything else.
  if (map.getLayer("esri-imagery")) map.setLayoutProperty("esri-imagery", "visibility", "none");
  // The Chinese labels are drawn for the LandsD topographic map; on any other base they are noise.
  if (map.getLayer("landsd-label-tc")) {
    map.setLayoutProperty("landsd-label-tc", "visibility", kind === "topo" ? "visible" : "none");
  }
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
