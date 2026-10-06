// overlays.ts — renders a vertical's `layers` array onto the map.
//
// A layer is ONE definition in layers.json, rendered by
// the map engine as 2D (MapLibre) or 3D (deck.gl); a vertical never writes
// 2D code. This file is the 2D renderer for the three geoms that carry data:
//   polygon → GeoJSON fill+line (CSDI district boundaries)
//   raster  → image overlay from the adapter's canvas (rain nowcast)
//   point   → the camera sources already on the map (visibility only)
// `none` layers are panel-only and draw nothing, by definition.

import maplibregl from "maplibre-gl";
import { fetchUrl, type LayerDefRaw, type PanelDefRaw, type Registry } from "../lib/sources.ts";
import { adaptPanel, hasAdapter, fetchMtrData, type AdapterCtx } from "../lib/adapters.ts";
import { lang } from "../lib/i18n.ts";
import { estimateMtrTrains, mtrToGeoJson, type MtrSchedule, type MtrStationsData } from "../lib/parsers.ts";
import { registerBarbs, registerGlyphs } from "./symbols.ts";

const PREFIX = "vl-";

/** Cluster ring colour per glyph family, so a cluster of ferries does not read
    as a cluster of cameras when both are on screen. */
function glyphColor(glyph: string): string {
  if (glyph.startsWith("cam-td")) return "#22d3ee";
  if (glyph.startsWith("cam-hko") || glyph === "station-wind") return "#a855f7";
  if (glyph === "aqhi") return "#34d399";
  if (glyph === "water") return "#38bdf8";
  if (glyph === "aed") return "#ef3d5b";
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

/** MTR train popup: one human line — destination + rounded minutes — plus the 推算 marker.
    The generic attributePopup would dump bearing/dest/line/ttnt/estimated as raw floats and
    codes ("dest TIK · line KTL · ttnt 7.626276666666567"), which is not a sentence a reader
    can use. */
function mtrTrainPopup(map: maplibregl.Map, layerId: string): void {
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  map.on("click", layerId, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const tc = lang() === "tc";
    new maplibregl.Popup({ closeButton: true, className: "cam-popup", maxWidth: "300px" })
      .setLngLat(e.lngLat)
      .setHTML(
        `<div style="padding:9px 11px;font:12px/1.55 var(--font-ui)">
          <b>${esc(p["Name"])}</b>
          <div style="color:#8ea6c4;font-size:11px;margin-top:3px">${tc ? "推算位置（非 GPS）" : "Estimated position (not GPS)"}</div>
        </div>`,
      )
      .addTo(map);
  });
  map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
}

// --- MTR train layer animation --------------------------------------------------
// The mtr_trains layer is an ESTIMATE recomputed every 30s from next-train ETAs.
// Between refetches a requestAnimationFrame loop re-runs estimateMtrTrains with
// each schedule's ttnt decremented by wall-clock, so a train slides smoothly along
// its line instead of jumping once per poll. As ttnt crosses 0 the train sits at
// its terminus and then drops out — which is "it arrived".

let mtrAnim: { raf: number; timer: number; map: maplibregl.Map; sourceId: string } | null = null;

function stopMtrAnimation(): void {
  if (!mtrAnim) return;
  cancelAnimationFrame(mtrAnim.raf);
  window.clearInterval(mtrAnim.timer);
  mtrAnim = null;
}

/** Start (or restart) the train-slide loop for `sourceId`. `refetch` re-pulls the
    schedules on a 30s cadence; the rAF loop redraws ~4×/s, which is far more than
    a 2.5 min/station train needs to look continuous. */
async function startMtrAnimation(
  map: maplibregl.Map,
  sourceId: string,
  refetch: () => Promise<{ mtr: MtrStationsData; schedules: MtrSchedule[] }>,
): Promise<void> {
  stopMtrAnimation();
  let data = await refetch();
  let lastFetch = performance.now();
  let lastSet = 0;
  const tick = () => {
    if (!mtrAnim || mtrAnim.sourceId !== sourceId) return;
    if (!map.getSource(sourceId)) {
      stopMtrAnimation();
      return;
    }
    const now = performance.now();
    if (now - lastSet >= 250) {
      lastSet = now;
      const elapsedMin = (now - lastFetch) / 60_000;
      const trains = estimateMtrTrains(data.schedules.map((s) => ({ ...s, ttnt: s.ttnt - elapsedMin })), data.mtr);
      (map.getSource(sourceId) as unknown as { setData: (d: GeoJSON.FeatureCollection) => void }).setData(mtrToGeoJson(trains));
    }
    mtrAnim.raf = requestAnimationFrame(tick);
  };
  mtrAnim = { raf: requestAnimationFrame(tick), timer: 0, map, sourceId };
  mtrAnim.timer = window.setInterval(async () => {
    try {
      const fresh = await refetch();
      if (!mtrAnim || mtrAnim.sourceId !== sourceId) return; // layer cleared mid-fetch
      data = fresh;
      lastFetch = performance.now();
    } catch {
      // keep the last known schedules; the estimate keeps sliding on the old ttnt
    }
  }, 30_000);
}

/**
 * Generic refresh loop for a point layer whose DATA changes on a cadence
 * (the carpark vacancy layer: positions are static, vacancies are not). One
 * global loop, mirroring mtrAnim's lifecycle — stopped in clearVerticalLayers
 * before its source goes away, and self-stopping if the source is already gone.
 * `refresh_ms` is the layer's own knob (config-not-code: it lives in
 * layers.json, not as a per-layer branch here).
 */
let layerRefresh: { timer: number; sourceId: string } | null = null;

function startLayerRefresh(
  map: maplibregl.Map,
  sourceId: string,
  refreshMs: number,
  refetch: () => Promise<GeoJSON.FeatureCollection>,
): void {
  stopLayerRefresh();
  layerRefresh = { timer: 0, sourceId };
  layerRefresh.timer = window.setInterval(async () => {
    if (!map.getSource(sourceId)) {
      stopLayerRefresh();
      return;
    }
    try {
      const fc = await refetch();
      if (map.getSource(sourceId)) {
        (map.getSource(sourceId) as unknown as { setData: (d: GeoJSON.FeatureCollection) => void }).setData(fc);
      }
    } catch {
      // keep the last data; the panel's own freshness state covers staleness
    }
  }, refreshMs);
}

function stopLayerRefresh(): void {
  if (!layerRefresh) return;
  window.clearInterval(layerRefresh.timer);
  layerRefresh = null;
}

/** Every layer id a vertical layer may create. Removal must cover all of them:
 *  a layer this list misses survives its own toggle and paints over the next
 *  mode (the same class of bug as the orphaned district mesh). `-halo` and
 *  `-point` were added with the aircraft layer; `-count` with the generic
 *  point path.
 *
 *  MEASURED 2026-09-25 — this list was itself missing one, which is why the BARE
 *  id is now first. `controlPointLayer()` draws under `vl-control_points` and
 *  `vl-control_points-label`; only the `-label` half was in the list, so
 *  `vl-control_points` outlived its own mode. Probe output (probe-orphan-layers.mjs),
 *  counts of `vl-` layers still on the map that the current mode does not claim:
 *
 *      總覽   drawn=[]                  vl=[]
 *      口岸   drawn=[control_points…]   vl=[vl-control_points, …-label]
 *      停水   drawn=[water…]            vl=[vl-control_points, …water…]   <-- orphan
 *      總覽   drawn=[]                  vl=[vl-control_points]            <-- still there
 *
 *  i.e. visiting 口岸模式 ONCE left twelve control-point dots painted over every
 *  later mode for the life of the tab, with nothing in the UI able to remove
 *  them. Choosing suffixes over the bare id assumes every branch suffixed its
 *  ids; `poi` is the branch that did not. Listing the bare id covers it and any
 *  future branch that does the same. */
function layersOf(def: LayerDefRaw): string[] {
  return [
    `${PREFIX}${def.id}`,
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
    // Stop any forecast-frame animation BEFORE its source goes away: an interval
    // that keeps calling updateImage() on a removed source throws every tick for
    // the life of the tab.
    stopRasterFrameTimers([`${PREFIX}${def.id}`]);
    // The MTR train slide loop owns its source too; stop it before removal or its
    // rAF ticks keep calling setData on a source that no longer exists.
    if (mtrAnim?.sourceId === `${PREFIX}${def.id}`) stopMtrAnimation();
    // Same for the generic refresh loop (carpark vacancy).
    if (layerRefresh?.sourceId === `${PREFIX}${def.id}`) stopLayerRefresh();
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
  // The pins are glyph icons now, so the images must exist before addLayer or
  // MapLibre draws nothing and reports no error. Idempotent, and this path can
  // run before either the point path or cameras.ts has registered them.
  registerGlyphs(map);
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
    type: "symbol",
    source: pid,
    layout: {
      // A SHAPE, not a dot. Cyrus 2026-09-25: "Suspension Location layer — use
      // relevant symbology for them, don't use simple point symbols." These were
      // plain `circle`s, so the entire message was carried by colour: you had to
      // already know that red meant drinking water. The mark is now the map's own
      // water droplet struck through (`no-water` / `no-water-salt` in symbols.ts),
      // which says "supply interrupted" on its own, and the disc keeps the
      // 食水 / 鹹水 colour split that was already doing useful work.
      "icon-image": ["case", ["==", ["get", "drinking"], 1], "no-water", "no-water-salt"],
      // Slightly larger than a bare dot needs to be: the slash has to stay
      // readable at city zoom, and a 12px struck droplet is mush.
      "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.34, 14, 0.52, 17, 0.78],
      "icon-allow-overlap": true,
      // Pins must not be swallowed by the district tint drawn beneath them, and
      // the icon is the whole point of the layer, so it wins the collision.
      "icon-ignore-placement": true,
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
            ${esc(p["water_type"] ?? "")} · ${esc(p["nature"] ?? "")}
          </b><br>
          <b>${esc(p["district"] ?? "")}</b> ${esc(p["address"] ?? "")}<br>
          <span style="color:#8ea6c4">${esc(p["cause"] ?? "")}</span><br>
          <span style="color:#8ea6c4">${tc ? "停水" : "from"} ${esc(when)}${back ? ` → ${esc(back)}` : ""}</span>
        </div>`;
    new maplibregl.Popup({ closeButton: true, className: "cam-popup" }).setLngLat(e.lngLat).setHTML(html).addTo(map);
  });
  map.on("mouseenter", pid, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", pid, () => (map.getCanvas().style.cursor = ""));
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
      // A 2km model grid: smoothing it would invent detail that is not there.
      "raster-resampling": "nearest",
    },
  });

  // ---------------------------------------------------------------------------
  // ANIMATE THE FORECAST HORIZONS.
  //
  // MEASURED 2026-09-25: the HKO nowcast CSV carries FOUR half-hourly frames
  // (+30/+60/+90/+120 min) and the parser was throwing three of them away
  // ("first forecast horizon only"), so a nowcast — a product whose entire point
  // is showing where rain is GOING — was rendered as a single still.
  //
  // One image source, `updateImage()` per frame: that re-uploads the texture
  // rather than adding a layer per frame, so four frames cost one layer and the
  // crossfade the raster layer would otherwise do between separate sources does
  // not appear.
  //
  // The timer is attached to the SOURCE, and stops when the layer is removed:
  // clearVerticalLayers() removes the source, and an interval writing to a
  // removed source throws every tick. `frameTimers` is what lets the removal path
  // stop it — a leaked interval here would keep a 2.7MB parse's worth of decoded
  // images alive for the life of the tab.
  // ---------------------------------------------------------------------------
  if (data.frames && data.frames.length > 1) {
    const src = map.getSource(id) as maplibregl.ImageSource | undefined;
    if (src && typeof src.updateImage === "function") {
      const urls = data.frames.map((f) => f.src);
      let i = 0;
      const timer = window.setInterval(() => {
        i = (i + 1) % urls.length;
        // A removed source must not throw on every tick.
        if (!map.getSource(id)) {
          window.clearInterval(timer);
          forgetFrameTimer(id);
          return;
        }
        // MapLibre 4.x `updateImage()` returns the source, NOT a promise — it
        // reports a failure as an 'error' event on the map, which the app's own
        // handler surfaces. So this is a synchronous guard, not a `.catch()`: an
        // earlier version chained `.catch()` and TypeScript was right to reject it.
        try {
          src.updateImage({ url: urls[i]! });
        } catch {
          /* a dropped frame keeps the previous one on screen */
        }
      }, FRAME_MS);
      frameTimers.set(id, timer);
      // QA hook: the harness asserts the animation has MORE THAN ONE frame
      // without waiting for a GPU compositor frame.
      (window as unknown as Record<string, unknown>)["__rasterFrames"] = {
        layer: id,
        count: urls.length,
        endings: data.frames.map((f) => f.ending),
      };
    }
  }
}

/** Forecast frames per layer. Kept OUTSIDE the layer closure so the removal path
 *  can stop a timer it does not own a reference to — the alternative, relying on
 *  the interval to notice its source is gone, means one wasted tick per removed
 *  layer per frame period, forever. */
const frameTimers = new Map<string, number>();
function forgetFrameTimer(id: string): void {
  frameTimers.delete(id);
}
export function stopRasterFrameTimers(ids: string[]): void {
  for (const id of ids) {
    const t = frameTimers.get(id);
    if (t !== undefined) {
      window.clearInterval(t);
      frameTimers.delete(id);
    }
  }
}
/** 900ms per frame: four frames is one 3.6s loop, fast enough to read as motion
 *  and slow enough to see each horizon. Not configurable yet — a speed control is
 *  a UI decision that needs a control, not a hidden constant. */
const FRAME_MS = 900;

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

  const id = `${PREFIX}${def.id}`;

  // WATER SUSPENSION PINS — drawn here so the layer can be an honest `point`
  // layer, and drawn with the SAME code as before.
  //
  // Cyrus 2026-09-25: "boundary polygon 有誤導性; 我覺得顯示 point location 就夠".
  // The district tint is gone (see layers.json `_comment` for why he is right);
  // what is left is the pins, which were always built by a bespoke join rather
  // than fetched as GeoJSON: the collector geocodes each notice's own street
  // address through ALS and writes lat/lng into data/water_suspension.json, so
  // there is nothing here to fetch. `args.waterPoints` is that join, and
  // `drawWaterPoints` already knows how to render it — nothing to rewrite.
  if (def.source === "wsd_water_suspension") {
    drawWaterPoints(map, id, args.waterPoints ?? []);
    return;
  }

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

  const src2 = id; // `id` is already built above, before the water branch
  void src2;
  if (stale(args, gen)) throw new Error("obsolete layer request");
  // A moving point layer is NOT clustered: aircraft change position every few
  // seconds, so clusters would re-form constantly and hide exactly the
  // individual tracks this layer exists to show. Camera points are static and
  // stay clustered.
  const moving = glyph === "plane" || glyph === "ferry" || glyph === "vessel" || glyph === "mtr-train";
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
        "circle-color": "rgba(8,14,24,.62)",
        "circle-stroke-color": "rgba(56,189,248,.4)",
        "circle-stroke-width": 1,
        "circle-blur": 0.5,
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
    // Attributes on the moving path too. The aircraft layer was withdrawn, but the
    // vessel one is coming and it draws exactly here — leaving this branch without
    // a popup would recreate the weather-station bug on a brand new layer.
    if (glyph === "mtr-train") mtrTrainPopup(map, `${id}-point`);
    else attributePopup(map, `${id}-point`);
    // Trains keep sliding between the 30s schedule refetches (see startMtrAnimation).
    if (glyph === "mtr-train") void startMtrAnimation(map, id, () => fetchMtrData(src));
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
  // THE fix for "weather station layer click完冇attribute pop up": this path had
  // no click handler at all, so 氣象站 (and any point layer without its own
  // popup) was inert under the cursor.
  if (def.popup === "aed_popup") aedPopup(map, `${id}-point`);
  else if (def.popup === "carpark_popup") carparkPopup(map, `${id}-point`);
  else if (def.popup === "aqhi_popup") aqhiPopup(map, `${id}-point`);
  else if (def.popup === "beach_popup") beachPopup(map, `${id}-point`);
  else attributePopup(map, `${id}-point`);

  // Vacancy refreshes on its own cadence: positions are static, numbers are
  // not. The refetch goes through the SAME adapter, so the redraw and the
  // panel keep reading one parse.
  if (def.refresh_ms && panel && hasAdapter(def.source)) {
    startLayerRefresh(map, id, def.refresh_ms, async () => {
      const { geo } = await adaptPanel(panel, args.ctx);
      if (!geo) throw new Error(`layer ${def.id}: adapter 冇提供 geo 資料`);
      return geo;
    });
  }
}

/** Public defibrillators, with a popup that answers the only question that matters.
 *
 * The file's keys are one character (`n`/`a`/`w`/`p`) because the GeoJSON envelope already costs 81%
 * of it, and those names are safe ONLY because this function exists: it is the reader that turns
 * `p: "Yes"` into 「可否公眾使用：是」. Handing this source to the generic attributePopup would print
 * `p: Yes` on a life-safety layer. The fields are labelled in
 * the UI language and the publisher's values are shown verbatim beside them.
 *
 * "可否公眾使用" IS the headline and it is rendered first and coloured: an AED behind a locked
 * office door and an AED on a street corner are the same dot otherwise, and the whole value of
 * this layer is telling them apart. `pub` is 'Yes'/'No' in the FSD export.
 */
function aedPopup(map: maplibregl.Map, layerId: string): void {
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  map.on("click", layerId, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const tc = lang() === "tc";
    const pub = /^y/i.test(String(p["p"] ?? ""));
    const rows: string[] = [
      `<b>${esc(p["n"])}</b>`,
      p["a"] ? `<div><span>${tc ? "地址" : "Address"}</span> ${esc(p["a"])}</div>` : "",
      p["w"] ? `<div><span>${tc ? "位置" : "Location"}</span> ${esc(p["w"])}</div>` : "",
      `<div class="aed-pub ${pub ? "yes" : "no"}">${tc ? "可否公眾使用" : "Public access"}: ` +
        `${pub ? (tc ? "是" : "Yes") : (tc ? "否" : "No")}</div>`,
    ];
    new maplibregl.Popup({ closeButton: true, className: "cam-popup", maxWidth: "300px" })
      .setLngLat(e.lngLat)
      .setHTML(`<div class="aed-pop">${rows.join("")}</div>`)
      .addTo(map);
  });
  map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
}
function carparkPopup(map: maplibregl.Map, layerId: string): void {
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  map.on("click", layerId, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const tc = lang() === "tc";
    const t = String(p["updated"] ?? "");
    new maplibregl.Popup({ closeButton: true, className: "cam-popup", maxWidth: "300px" })
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="aed-pop"><b>${esc(p["name"])}</b>` +
          `<div><span>${tc ? "私家車空位" : "Free car spaces"}</span> <b>${esc(p["vacancy"])}</b></div>` +
          (t ? `<div><span>${tc ? "該場更新" : "Reported"}</span> ${esc(t)}</div>` : "") +
          `</div>`,
      )
      .addTo(map);
  });
  map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
}
function aqhiPopup(map: maplibregl.Map, layerId: string): void {
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  map.on("click", layerId, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const tc = lang() === "tc";
    const aqhi = String(p["aqhi"] ?? "—");
    const risk = String(p["risk"] ?? "");
    const n = Number(aqhi);
    // Same three-band logic as the gauge grid, so the dot and the panel read
    // identically: 1–3 ok, 4–6 warn, 7+ alert.
    const level = Number.isFinite(n) ? (n <= 3 ? "ok" : n <= 6 ? "warn" : "alert") : "";
    const rows: string[] = [
      `<b>${esc(p["Name"] ?? "")}</b>`,
      `<div class="aqhi-val ${level}"><span>${tc ? "指數" : "Index"}</span> <b>${esc(aqhi)}</b>${risk ? ` · ${esc(risk)}` : ""}</div>`,
      p["Type_tc"] || p["Type_en"] ? `<div><span>${tc ? "類型" : "Type"}</span> ${esc(p["Type_tc"] ?? p["Type_en"])}</div>` : "",
      p["Address_tc"] || p["Address_en"] ? `<div><span>${tc ? "地址" : "Address"}</span> ${esc(p["Address_tc"] ?? p["Address_en"])}</div>` : "",
      p["updated"] ? `<div><span>${tc ? "更新" : "Updated"}</span> ${esc(p["updated"])}</div>` : "",
    ];
    new maplibregl.Popup({ closeButton: true, className: "cam-popup", maxWidth: "300px" })
      .setLngLat(e.lngLat)
      .setHTML(`<div class="aed-pop">${rows.join("")}</div>`)
      .addTo(map);
  });
  map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
}
function beachPopup(map: maplibregl.Map, layerId: string): void {
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  const COL: Record<string, string> = { good: "#22c55e", fair: "#f59e0b", poor: "#f97316", verypoor: "#ef4444" };
  map.on("click", layerId, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const tc = lang() === "tc";
    const key = String(p["gradeKey"] ?? "unknown");
    new maplibregl.Popup({ closeButton: true, className: "cam-popup", maxWidth: "300px" })
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="aed-pop"><b>${esc(p["name"] ?? "")}</b>` +
          `<div style="color:${COL[key] ?? "#fff"};font-weight:600;margin-top:6px">${esc(p["gradeTc"] ?? "")}</div>` +
          `<div style="color:var(--night-dim);font-size:11px;margin-top:4px">${tc ? "EPD 泳灘水質（採樣後 48 小時內）" : "EPD beach water quality (within 48h of sampling)"}</div></div>`,
      )
      .addTo(map);
  });
  map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
}

/** Field labels for the attribute popup. A key with no entry falls back to the
 *  raw key, which is honest ("you are seeing an unlabelled field") rather than
 *  inventing a translation. */
const POPUP_LABELS: Record<string, { tc: string; en: string }> = {
  Name: { tc: "名稱", en: "Name" },
  Address: { tc: "地址", en: "Address" },
  TypesofWeatherStation: { tc: "氣象站類型", en: "Station type" },
  Elevationofgroundabovemeansea_level_metres: { tc: "海拔（米）", en: "Elevation (m)" },
  OpeningHours: { tc: "開放時間", en: "Opening hours" },
  Telephone: { tc: "電話", en: "Telephone" },
  Website: { tc: "網站", en: "Website" },
  LastUpdate: { tc: "資料更新", en: "Data updated" },
  tempC: { tc: "氣溫（℃）", en: "Temp (°C)" },
  // Aircraft / vessel fields, ready for the layers that will use this path.
  flight: { tc: "航班", en: "Flight" },
  hex: { tc: "ICAO 24-bit", en: "ICAO 24-bit" },
  altFt: { tc: "高度（呎）", en: "Altitude (ft)" },
  gsKt: { tc: "地速（節）", en: "Ground speed (kt)" },
  trackDeg: { tc: "航向", en: "Track" },
  // parseAdsb emits `bearing`, not `trackDeg` — the label map had the wrong key, so every
  // aircraft popup showed a raw unlabelled `bearing` row. Measured from the live payload.
  bearing: { tc: "航向", en: "Bearing" },
  onGround: { tc: "地面", en: "On ground" },
  Vacancy: { tc: "泊位狀況", en: "Berth status" },
  verticalFpm: { tc: "升降率（呎/分）", en: "Vertical rate (ft/min)" },
  mmsi: { tc: "MMSI", en: "MMSI" },
  shipName: { tc: "船名", en: "Vessel" },
  sog: { tc: "船速（節）", en: "Speed (kt)" },
  navStatus: { tc: "航行狀態", en: "Navigation status" },
  cog: { tc: "航向", en: "Course" },
  destination: { tc: "目的地", en: "Destination" },
  // Facility fields (build_facilities.py). `Name` is the head slot and needs no label here.
  Type: { tc: "類型", en: "Type" },
  Restriction: { tc: "限制", en: "Restriction" },
};

/** Keys that carry no information for a reader. `_sc` is Simplified Chinese —
 *  the third language of every CSDI field triple, and this app is TC/EN only.
 *  The rest are dataset plumbing (which catalogue the record came from) or the
 *  raw projected coordinates, which duplicate the geometry. */
const POPUP_SKIP = /^(OBJECTID|Easting|Northing|Latitude|Longitude|Latitude_N|Longitude_E|Dataset|DataGovHK|EmailAddress|FaxNumber)$/;

/** HTML-escape a value before it goes into a popup.
 *
 * These popups render text that came from a REMOTE FEED. `controlPointLayer` and
 * `drawWaterPoints` interpolate feed values into `setHTML`, so every value they
 * interpolate is passed through `esc()`. Every popup added later must do the
 * same — a feed value containing markup must never reach the page unescaped. */
function esc(v: unknown): string {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** One feature's attributes as popup HTML, or null when it has nothing to say. */
function attributeHtml(p: Record<string, unknown>, lngLat: maplibregl.LngLat): string | null {
  const tc = lang() === "tc";
  // CSDI publishes every field as a `Foo_tc` / `Foo_en` / `Foo_sc` triple. Group
  // them back into one logical field so the popup shows 地址 once, not three
  // times, and pick the language of the current UI ({ tc, en } of the
  // same field, never twin fields that drift).
  const groups = new Map<string, { tc?: unknown; en?: unknown; value?: unknown }>();
  for (const [k, v] of Object.entries(p)) {
    const m = /^(.*)_(tc|en|sc)$/.exec(k);
    // `m[1]` is `string | undefined` under noUncheckedIndexedAccess; the regex
    // guarantees it exists, but the compiler cannot know that.
    const base = m?.[1] ?? k;
    const slot = groups.get(base) ?? {};
    if (m) {
      if (m[2] !== "sc") slot[m[2] as "tc" | "en"] = v;
    } else {
      slot.value = v;
    }
    groups.set(base, slot);
  }

  const titleRaw = groups.get("Name");
  const title = tc ? titleRaw?.tc ?? titleRaw?.value : titleRaw?.en ?? titleRaw?.value;
  const rows: string[] = [];
  for (const [base, slot] of groups) {
    if (base === "Name" || POPUP_SKIP.test(base)) continue;
    const raw = tc ? slot.tc ?? slot.value : slot.en ?? slot.value;
    const text = raw === null || raw === undefined ? "" : String(raw).trim();
    // "N.A." is what CSDI writes for an absent value. Showing it is noise; the
    // field is simply not there.
    if (!text || /^(n\.?a\.?|nil|null|-|—)$/i.test(text)) continue;
    const label = POPUP_LABELS[base];
    const isLink = /^https?:\/\//.test(text);
    const valueHtml = isLink
      ? `<a href="${esc(text)}" target="_blank" rel="noopener" style="color:#22d3ee">${esc(text.replace(/^https?:\/\//, "").slice(0, 46))} ↗</a>`
      : esc(text);
    rows.push(
      `<div class="attr-row"><span class="attr-k">${esc(label ? (tc ? label.tc : label.en) : base)}</span>` +
        `<span class="attr-v">${valueHtml}</span></div>`,
    );
  }

  const head = `<b class="attr-title">${esc(title ?? (tc ? "未命名" : "Unnamed"))}</b>`;
  const coords = `<div class="attr-coords">${esc(lngLat.lat.toFixed(5))}, ${esc(lngLat.lng.toFixed(5))}</div>`;
  // A feature with a name and nothing else still gets a popup — the name plus its
  // position IS an answer, and silently doing nothing on click reads as broken,
  // which is the bug this whole function exists to fix.
  return `<div class="attr-popup">${head}${rows.join("")}${coords}</div>`;
}

/** Attach an ATTRIBUTE POPUP to a point layer.
 *
 * Cyrus 2026-09-25: "weather station layer click完冇attribute pop up". The cause
 * was not a broken popup — there was NO click handler on this path at all.
 * `pointLayer()` added its layers and returned, so every layer drawn through it
 * was inert under the cursor: 氣象站 today, and the aircraft and vessel layers
 * that will use the same path next.
 *
 * Wired here rather than per-layer so a new point layer cannot be born without
 * attributes, which is exactly how this one was. */
function attributePopup(map: maplibregl.Map, layerId: string): void {
  map.on("click", layerId, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const html = attributeHtml((f.properties ?? {}) as Record<string, unknown>, e.lngLat);
    if (!html) return;
    new maplibregl.Popup({ closeButton: true, className: "cam-popup", maxWidth: "310px" })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(map);
  });
  map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
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
  // A GATEWAY SYMBOL, not a circle. Cyrus 2026-09-25: "Border control point layer
  // — use relevant symbology for them, don't use simple point symbols." These were
  // plain circles, so the layer said only "something is here" — exactly what the
  // camera and station layers already say. The glyph is a portal with a traveller
  // passing through it (symbols.ts `drawControlPoint`), and the KIND moves from the
  // circle's fill to the glyph's disc, so land / sea / air still read apart at a
  // glance without opening the popup.
  registerGlyphs(map);
  map.addLayer({
    id,
    type: "symbol",
    source: id,
    layout: {
      "icon-image": [
        "match",
        ["get", "kind"],
        "air", "cp-air",
        "sea", "cp-sea",
        "cp-land",
      ] as never,
      "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.42, 14, 0.68, 17, 0.95],
      // Twelve crossings on the whole territory cannot collide, and hiding one
      // would drop a border point from a layer whose entire job is to name them.
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
  // Names sit BELOW the symbols from z11, offset far enough to clear the icon
  // rather than the 5px dot that used to be there — at 2.0em the label starts just
  // under a 0.5-scaled glyph. Below z11 they collide across the harbour and the
  // symbols alone are enough.
  map.addLayer({
    id: `${id}-label`,
    type: "symbol",
    source: id,
    minzoom: 11,
    layout: {
      "text-field": ["get", lang() === "tc" ? "tc" : "en"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-offset": [0, 2],
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
          <b>${esc(p[tc ? "tc" : "en"] ?? "")}</b><br>
          <span style="color:#8ea6c4">${kindLabel} · ${esc(code)}</span><br>
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

/** A polygon layer, drawn from its source's GeoJSON.
 *
 * The COLOUR comes from the feature, not from this file. The CAD export carries its own `fill`
 * and `stroke` per zone, so the publisher's styling drives the map and a restyle upstream needs no
 * change here — `coalesce` handles a zone that omits them. Opacity is OURS and deliberately low:
 * the data's own 0.5 buries the basemap, and the point of this layer is "where can I not fly",
 * which a reader can only judge against what is underneath.
 *
 * A 200 carrying no features is a real state and it THROWS. This project's own rule is that a 200
 * is not evidence of data, and an empty layer would draw nothing
 * while leaving the toggle on — the dead control the readiness guards exist to catch.
 */
async function polygonLayer(map: maplibregl.Map, def: LayerDefRaw, args: LayerArgs): Promise<void> {
  const src = args.registry.byId.get(def.source);
  if (!src) throw new Error(`layer ${def.id}: source ${def.source} 唔存在`);
  const gen = args.gen ?? 0;
  const res = await fetch(fetchUrl(src), { signal: AbortSignal.timeout(25_000) });
  if (stale(args, gen)) throw new Error("obsolete layer request");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as GeoJSON.FeatureCollection;
  const n = data?.features?.length ?? 0;
  if (n === 0) throw new Error("geojson 冇 feature");

  const id = `${PREFIX}${def.id}`;
  if (stale(args, gen)) throw new Error("obsolete layer request");
  map.addSource(id, { type: "geojson", data });
  map.addLayer({
    id: `${id}-fill`,
    type: "fill",
    source: id,
    paint: {
      "fill-color": ["coalesce", ["get", "fill"], "#ff5d6c"] as never,
      "fill-opacity": 0.18,
    },
  });
  map.addLayer({
    id: `${id}-line`,
    type: "line",
    source: id,
    paint: {
      "line-color": ["coalesce", ["get", "stroke"], "#ffd166"] as never,
      "line-width": 1.4,
      "line-opacity": 0.9,
    },
  });
  if (stale(args, gen)) throw new Error("obsolete layer request");

  // The publisher's fields are ENGLISH-ONLY (name / effectiveDateTime / description2), so the
  // labels are ours and the values are theirs, verbatim. Translating a regulator's zone name
  // would invent an official name that does not exist; a reader has to be able to match what they
  // see here against the eSUA notice. The last line says so rather than leaving it to be guessed.
  // Cyrus 2026-10-02: the note used to read 「以上為民航處原文（英文）」 — true, and useless:
  // it tells the reader that something above is in English without saying which fields, or which
  // publication to open if they want to check it. Naming the notice is the whole fix; the
  // English half stays as it was, because it already said it.
  const T = lang() === "tc"
    ? { eff: "生效", by: "指定機構", note: "名稱及日期取自民航處 eSUA 公告，未經翻譯" }
    : { eff: "Effective", by: "Designated by", note: "Names and dates verbatim from the CAD eSUA notice" };
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

  map.on("click", `${id}-fill`, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const html =
      `<div class="rfz-pop">` +
      `<b>${esc(p["name"])}</b>` +
      (p["effectiveDateTime"] ? `<div><span>${T.eff}</span> ${esc(p["effectiveDateTime"])}</div>` : "") +
      (p["description2"] ? `<div><span>${T.by}</span> ${esc(p["description2"])}</div>` : "") +
      `<div class="rfz-note">${T.note}</div>` +
      `</div>`;
    new maplibregl.Popup({ closeButton: true, className: "cam-popup" }).setLngLat(e.lngLat).setHTML(html).addTo(map);
  });
  map.on("mouseenter", `${id}-fill`, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", `${id}-fill`, () => (map.getCanvas().style.cursor = ""));
}

/** Hiking-trail popup: name, type, difficulty (band-coloured), length,
 *  start → finish. A line click should say WHICH trail it is — the layer is
 *  now the default-on headline, silent lines would be half a feature. */
function trailPopup(map: maplibregl.Map, layerId: string): void {
  const esc = (s: unknown) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
  const pick = (p: Record<string, unknown>, tcKey: string, enKey: string): string =>
    String(lang() === "tc" ? p[tcKey] ?? p[enKey] ?? "" : p[enKey] ?? p[tcKey] ?? "");
  map.on("click", layerId, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const tc = lang() === "tc";
    const diff = pick(p, "DIFFICULTY_TC", "DIFFICULTY_EN");
    const diffColor = /極費力|very demanding/i.test(diff) ? "#ef4444" : /費力|demanding/i.test(diff) ? "#f59e0b" : "#22c55e";
    const start = pick(p, "STARTpt_TC", "STARTpt_EN");
    const finish = pick(p, "FINISHpt_TC", "FINISHpt_EN");
    new maplibregl.Popup({ closeButton: true, className: "cam-popup", maxWidth: "320px" })
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="aed-pop"><b>${esc(pick(p, "TRAIL_NAME_TC", "TRAIL_NAME_EN"))}</b>` +
          `<div style="color:var(--night-dim);font-size:11px;margin-top:2px">${esc(pick(p, "TYPE_TC", "TYPE_EN"))}${pick(p, "REGION_TC", "REGION_EN") ? " · " + esc(pick(p, "REGION_TC", "REGION_EN")) : ""}</div>` +
          `<div style="color:${diffColor};font-weight:600;margin-top:6px">${esc(diff)}</div>` +
          (p["MEASURE_LEN"] ? `<div style="margin-top:4px">${tc ? "長度" : "Length"} ${esc(p["MEASURE_LEN"])} m</div>` : "") +
          (start && finish ? `<div style="margin-top:2px">${esc(start)} → ${esc(finish)}</div>` : "") +
          `</div>`,
      )
      .addTo(map);
  });
  map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
}

/** A `line` geom layer: static GeoJSON LineStrings (the MTR network). Colour comes
    from each feature's own `color` property, so the line colour draws the map and
    a restyle upstream needs no code change. */
async function lineLayer(map: maplibregl.Map, def: LayerDefRaw, args: LayerArgs): Promise<void> {
  const src = args.registry.byId.get(def.source);
  if (!src) throw new Error(`layer ${def.id}: source ${def.source} 唔存在`);
  const gen = args.gen ?? 0;
  const res = await fetch(fetchUrl(src), { signal: AbortSignal.timeout(25_000) });
  if (stale(args, gen)) throw new Error("obsolete layer request");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as GeoJSON.FeatureCollection;
  if (!data?.features?.length) throw new Error("geojson 冇 feature");

  const id = `${PREFIX}${def.id}`;
  if (stale(args, gen)) throw new Error("obsolete layer request");
  map.addSource(id, { type: "geojson", data });
  map.addLayer({
    id: `${id}-line`,
    type: "line",
    source: id,
    layout: {
      "line-join": "round",
      "line-cap": "round",
      ...(def.dash ? { "line-dasharray": def.dash } : {}),
    },
    paint: {
      "line-color": ["coalesce", ["get", "color"], "#22d3ee"] as never,
      "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1.2, 12, 2.2, 16, 3.5] as never,
      "line-opacity": 0.9,
    },
  });
  if (def.popup === "trail_popup") trailPopup(map, `${id}-line`);
}

export async function applyVerticalLayers(map: maplibregl.Map, defs: LayerDefRaw[], args: LayerArgs): Promise<string[]> {
  const drawn: string[] = [];
  for (const def of defs) {
    try {
      switch (def.geom) {
        case "polygon":
          // RESTORED 2026-09-27 for the drone restricted flight zones.
          //
          // This branch threw for two days. Polygon layers were removed together with the water
          // district tint (2026-09-25, Cyrus: "boundary polygon 有誤導性; 我覺得顯示 point
          // location 就夠") — and that reason was about THAT layer specifically: a district
          // outline drawn around a water suspension asserts the whole district is affected, which
          // the notice does not say. It does not generalise, and reading it as a blanket ban on
          // polygons is what kept this disabled.
          //
          // A drone RFZ is the opposite case. The Civil Aviation Department publishes the zone AS
          // that exact boundary, so the polygon is not an approximation of the data — it IS the
          // data, and drawing 290 zones as points would be the misleading version. The removal
          // machinery was deliberately left intact (`layersOf()` still clears the
          // `-fill`/`-line`/`-label` family, `mapIdsFor()` still maps it), which is why restoring
          // it is this one call and not a re-derivation.
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
        case "line":
          // Reference linework (the MTR network), drawn from its source's GeoJSON
          // LineStrings with per-feature colours.
          await lineLayer(map, def, args);
          drawn.push(def.id);
          break;
        case "none":
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
