// main.ts — boot and wiring. This is the only place that knows the app has
// modes, a map, panels and a trigger loop; everything it wires is either data
// (registries) or one of the small primitives.
//
// The trigger engine runs on its OWN poll of the two trigger-relevant sources,
// not on whatever panels happen to be visible: a rainstorm warning must be
// able to change the screen even if its panel was never opened.

import "./styles/tokens.css";
import "./styles/app.css";

import { MIN_REFRESH_MS, WORKER_BASE, hasWorker } from "./config.ts";
import { browserRasterizer } from "./map/raster.ts";
import { activeVertical, type State, type VerticalDef } from "./lib/trigger.ts";
import { adaptPanel } from "./lib/adapters.ts";
import { h, clear } from "./lib/dom.ts";
import { lang, onLangChange, t } from "./lib/i18n.ts";
import { loadRegistry, clearDataCache, sourceLabel, type VerticalDefRaw } from "./lib/sources.ts";
import { createMap, landsdBadge, setBasemap } from "./map/basemap.ts";
import { addCameraLayers, loadCameras, TD_SRC, HKO_SRC, type Camera } from "./map/cameras.ts";
import { applyVerticalLayers, clearVerticalLayers, type WaterPoint } from "./map/overlays.ts";
import { createLayerControl, relabelLayerControl, type LayerRow } from "./ui/layercontrol.ts";
import { toggleWind } from "./map/wind2d.ts";
import type { LayerDefRaw } from "./lib/sources.ts";
import { createDrawer } from "./ui/drawer.ts";
import { createPanelEngine } from "./ui/panels.ts";
import { createStatusBar } from "./ui/statusbar.ts";
import { createFooter } from "./ui/footer.ts";
import { createMapHead, relabelMapHead } from "./ui/maphead.ts";
import { createTicker } from "./ui/ticker.ts";
import { createPalette } from "./ui/palette.ts";
import { createFocusHud } from "./ui/focushud.ts";
import { createGroupTabs, labelFor, type GroupTab } from "./ui/grouptabs.ts";

/** The vertical-free default view. Ordered as a World-Monitor-style dense
    wall: imagery heads the column, then life-safety and civic reads. */
const OVERVIEW = [
  // FIRST because it is the only panel that speaks: a free model reading the published
  // figures back in two sentences. Cyrus asked for it on top and the anomaly panel gone.
  "ai_brief",
  // The conclusion panel goes FIRST: it is the only surface that answers "so what", and every
  // other panel is evidence for it. It is FED rather than fetched (see FED_PANEL_IDS in
  // ui/panels.ts) because it is drawn FROM the other panels, not from a source.
  // RESTORED 2026-09-27 with the PC collector. A city with the world's busiest cargo airport on its
  // doorstep should say what is overhead without being asked.
  "aircraft_status",
  // Vessel AIS — the marine counterpart to the aircraft read. A 6-hourly snapshot (not live):
  // aisstream.io, the only free live AIS feed, went silent 2026-08.
  "vessel_status",
  // ONE live wall with region tabs, not two panels side by side. The camera wall is a
  // city's own eyes (1,013 TD + 34 HKO cameras, an asset no global project has) and the
  // news wall is what the world is saying about it; two panels meant two ~300px blocks
  // scrolling past each other and neither said they were related. The tab set comes from
  // data/live_streams.json, so the regions are data and this stays a single id.
  "live_wall",
  "warnings_list",
  "breaking_news_list",
  "wind_status",
  "stations_status",
  "cameras_wall",
  "hko_cameras_wall",
  "special_traffic_list",
  "mtr_next_train_list",
  "tp_queue_grid",
  "hk_market_table",
  // crypto_prices withdrawn 2026-09-24: CoinGecko 429s Cloudflare's egress on
  // every production load. See the _comment in data/panels.json for the restore
  // path — the adapter and its tests are intentionally left in place.
  "aqhi_gauge_grid",
  "carpark_vacancy_list",
  "ae_waiting_grid",
  "water_suspension_list",
];

/** Trigger polling: 3 minutes. This interval is the REAL cadence for the two
 *  trigger sources (see the list in pollTriggers) — not the cadence their panels
 *  declare — because a trigger must fire even when its panel is hidden, and that
 *  loop is the only fetch which runs unconditionally.
 *
 *  Why 3 minutes: hko_warnsum goes through the Worker, which edge-caches 60s, so a
 *  faster loop would buy nothing there. The other source is the exception —
 *  wsd_water_suspension is read from the collector's static JSON
 *  (scripts/build_water_suspension.py), NOT through the Worker, and that file is
 *  rebuilt on its own schedule. 3 minutes is the faster of the two, so neither is
 *  polled faster than it can change. */
const TRIGGER_POLL_MS = 3 * 60_000;

const RAIL_LAYERS: { id: string; label: { tc: string; en: string }; on?: boolean }[] = [
  { id: "cameras_td", label: { tc: "運輸署相機", en: "TD cameras" }, on: true },
  { id: "cameras_hko", label: { tc: "天文台相機", en: "HKO cameras" }, on: true },
  // 航機（ADS-B）withdrawn from the shipped UI 2026-09-23.
  //
  // MEASURED: adsb.fi and adsb.lol both answer 200 from a home IP but return
  // 403/429 to Cloudflare's egress — they block datacenter ranges. Deployed, the
  // layer therefore cannot load, and a permanently-erroring toggle is worse than
  // no toggle. The code path is intact (layers.json entry, adapter, plane glyph,
  // rotation): re-add the rail entry and the overview panel when a source that
  // tolerates cloud egress is found, or when a PC-side collector publishes a
  // static JSON the front end can read (the water-suspension pattern).
  // RESTORED 2026-09-27. The withdrawal note named its own restore condition — a PC-side collector
  // publishing static JSON — and scripts/collect_aircraft.py is that collector. The layer reads
  // data/aircraft.json, so api.adsb.lol's block on cloud egress is no longer in the path.
  { id: "aircraft", label: { tc: "航機（社群 ADS-B）", en: "Aircraft (community ADS-B)" }, on: true },
  // Estimated, not GPS: MTR publishes no vehicle positions, so these dots are
  // interpolated from next-train ETAs. OFF by default so a reader turns it on
  // deliberately rather than mistaking an estimate for a fix.
  { id: "mtr_trains", label: { tc: "港鐵列車（推算）", en: "MTR trains (estimated)" } },
  // Reference network under the train layer — the reader turns this on to read the
  // moving trains against the lines they run on. OFF by default.
  { id: "mtr_lines", label: { tc: "港鐵路線", en: "MTR lines" } },
  // 「（模式格網）」 is not decoration. This layer is Open-Meteo MODEL output, and
  // `weather_stations` one row below is the OBSERVED counterpart — two layers with
  // the same subject and different epistemics, one click apart. The rail label is
  // what the LAYERS control shows (`railLabel()` prefers it over the layers.json
  // title), so a bare 「風場」 here would have hidden the only word on screen that
  // says "this is a model, not a measurement" — which is the whole honesty rule for
  // this layer. 風場 stays as the prefix so the label still reads as wind at a
  // glance and every existing `includes("風場")` selector keeps working.
  { id: "wind_field", label: { tc: "風場（模式格網）", en: "Wind flow (modelled)" } },
  { id: "weather_stations", label: { tc: "氣象站", en: "Weather stations" } },
  // OFF by default, and it stays that way: 290 polygons is 3MB, which is more than the entire
  // first paint of this app. It needs a `case` in toggleLayer() like every other layer — that
  // switch has no generic default, it THROWS, and an earlier draft of this change assumed
  // otherwise and shipped a toggle that answered `unknown layer drone_rfz`.
  { id: "drone_rfz", label: { tc: "無人機禁飛區", en: "Drone restricted zones" } },
  // Life-safety, and the only layer here that does not come from a feed about the city — it is
  // about the reader. OFF by default at 707KB, so a reader who needs it turns it on and a reader
  // who does not never pays for it.
  { id: "aed_locations", label: { tc: "公眾 AED", en: "Public AEDs" } },
  // 公眾貨物裝卸區（海事處）＋機場進場限制區（民航處）. 128 polygons from CSDI, 134KB, OFF by default.
  // These are the facilities 貨運模式's panels are ABOUT — before this the mode listed flight and
  // traffic rows with nothing on the map saying where the cargo actually moves.
  { id: "hk_facility_areas", label: { tc: "貨運及機場設施", en: "Cargo & airport facilities" } },
  // 23 貯油裝置（屋宇署牌照名單）, 8KB. Small enough to be on by default, but it stays off: it is
  // one mode's subject, and a layer that appears in 總覽 without being asked for is the thing the
  // verticals exist to prevent.
  { id: "hk_facility_pins", label: { tc: "貯油裝置", en: "Oil storage installations" } },
  // Vessel positions (AIS via VesselAPI, 6-hourly snapshot) — the marine counterpart to the
  // aircraft layer, and the layer that replaces the withdrawn berth-vacancy polygon.
  { id: "vessels", label: { tc: "船位置", en: "Vessel positions" } },
  // ON BY DEFAULT. "Is it raining right now" is the first situational question in Hong Kong, and
  // this is HKO's own gridded nowcast — a measurement, not a model, which is why it is a better
  // default than wind_field one row up (that one is Open-Meteo MODEL output and says so in its
  // label). The other three satellite layers stay off: ae_hospitals, water_suspension and
  // control_points are VERTICAL-driven by design, and turning them on here would fight the
  // config-not-code architecture the verticals exist to prove.
  { id: "rain_nowcast", label: { tc: "降雨臨近預報", en: "Rain nowcast" }, on: true },
  { id: "imagery", label: { tc: "航拍底圖", en: "Aerial basemap" } },
  // Keyless Esri bases (Cyrus 2026-10-02). A basemap is a choice, not a layer: these switch the
  // base under everything, and setBasemap() keeps them mutually exclusive.
  { id: "esri_topo", label: { tc: "Esri 地形圖", en: "Esri topographic" } },
  { id: "esri_gray", label: { tc: "Esri 淺灰底圖", en: "Esri light gray" } },
];

async function boot(): Promise<void> {
  const statusbar = createStatusBar(document.getElementById("statusbar")!);
  const mapHeadEl = document.getElementById("mapHead")!;
  const mapHead = createMapHead(mapHeadEl);
  onLangChange(() => {
    relabelMapHead(mapHeadEl);
    relabelLayerControl(layerEl, currentLayerRows);
    // `registry` is loaded further down; this handler only ever fires on a user action,
    // which cannot happen before boot finished.
    wireModes();
  });
  const tickerEl = document.getElementById("ticker")!;
  const panelsEl = document.getElementById("panels")!;
  // The footer closes the panel column: authorship, licence, and the publishers this is built
  // on. Wording is Cyrus's call — see footer.ts for why it credits rather than disclaims.
  // Under the map AND the panels (Cyrus 2026-10-02). Appended to the body rather than to
  // #layout: #layout is the two-column grid, so a footer inside it would be a grid item sitting
  // beside the map rather than below it.
  createFooter(document.body);
  const mapEl = document.getElementById("map")!;
  const hudEl = document.getElementById("mapHud")!;
  // The 3D switch (Cyrus 2026-10-02: "Map View 度加粒 button switch 去 Open3Dhk 攞香港個 3D tile").
  // The tileset is 12.2M triangles, so the deck.gl overlay AND the tileset URL both sit behind the
  // dynamic import inside map/overlays3d.ts - turning this on is the only thing that fetches
  // either, and measure:boot fails if a 3D chunk ever reaches the critical path.
  const btn3d = h("button", { class: "btn-3d", type: "button", "aria-pressed": "false" }, "3D");
  let on3d = false;
  let busy3d = false;
  // State is carried by the LABEL as well as the outline: colour alone would leave the button
  // saying the same word in both states, on a face where colour is the one thing the reader may
  // not be able to see.
  const sync3d = () => {
    const tc = lang() === "tc";
    btn3d.textContent = on3d ? (tc ? "3D 開" : "3D ON") : "3D";
    btn3d.setAttribute("aria-pressed", String(on3d));
    btn3d.title = tc
      ? "切換 3D 建築（地政總署 Open3Dhk 三維數碼地圖，lazy 載入）"
      : "Toggle 3D buildings (LandsD Open3Dhk 3D digital map, lazy)";
  };
  btn3d.addEventListener("click", async () => {
    if (busy3d) return;
    busy3d = true;
    btn3d.classList.add("busy");
    try {
      const { toggle3d } = await import("./map/overlays3d.ts");
      await toggle3d(map, !on3d);
      on3d = !on3d;
    } catch (err) {
      // Never a blank scene: the failure says what failed, on the map face, for long enough to
      // read. A tileset that lands in an error state is a working monitor; one that silently
      // draws nothing looks like the button is broken.
      on3d = false;
      const why = err instanceof Error ? err.message : String(err);
      const tc = lang() === "tc";
      const msg = h("div", { class: "btn-3d-msg" },
        (tc ? "3D 圖層開唔到：" : "3D layer failed: ") + why);
      hudEl.append(msg);
      window.setTimeout(() => msg.remove(), 9000);
      btn3d.classList.add("err");
      window.setTimeout(() => btn3d.classList.remove("err"), 9000);
    } finally {
      busy3d = false;
      btn3d.classList.remove("busy");
      sync3d();
    }
  });
  sync3d();
  onLangChange(() => sync3d());
  hudEl.append(btn3d);
  const drawerEl = document.getElementById("drawer")!;
  const panelTabsEl = document.getElementById("panelTabs")!;
  const panelRestoreEl = document.getElementById("panelRestore")!;

  const [registry, cameras, manifest] = await Promise.all([
    loadRegistry(),
    loadCameras(),
    fetch("data/build-manifest.json").then((r) => r.json() as Promise<{ tilesVia: string }>).catch(() => ({ tilesVia: "direct" })),
  ]);
  createTicker(tickerEl, registry);

  statusbar.setTiles(manifest.tilesVia);
  statusbar.setCameras(cameras.td.length, cameras.hko.length);

  const map = createMap(mapEl);
  // QA hook — the element id `map` shadows a global `map`, so the instance is
  // exposed explicitly (measured pitfall, AGENTS.md).
  (window as unknown as Record<string, unknown>)["__map"] = map;

  const drawer = createDrawer(drawerEl);
  // GEV grammar: clicking a camera tethers a compact HUD label to the point
  // (name + coords + thumbnail) while the full drawer opens beneath.
  const focusHud = createFocusHud(map, mapEl.parentElement ?? mapEl);
  addCameraLayers(map, cameras, {
    onSelect: (cam: Camera) => {
      focusHud.show(cam);
      drawer.openCamera(cam);
    },
  });
  hudEl.append(landsdBadge());

  // GEV-style constant readout: the pointer's position on the map, bottom-left
  // above the scale bar. Provably the mouse's true coordinates, never a guess.
  const coordsEl = h("span", { class: "map-coords", style: "position:absolute;left:10px;bottom:34px" });
  hudEl.append(coordsEl);
  map.on("mousemove", (e) => {
    coordsEl.textContent = `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`;
  });
  map.on("mouseleave", () => (coordsEl.textContent = ""));

  const banner = h("div", { class: "panel", style: "position:absolute;left:12px;top:64px;max-width:420px;display:none" });
  hudEl.append(banner);

  // LAYERS control — replaces the old passive legend. Same registry, so a row
  // cannot describe a layer that is not drawable; unlike the legend it can be
  // toggled, which is what makes the map face an instrument rather than a
  // caption (World Monitor grammar, plan §9.1).
  const layerEl = h("div", { class: "layer-control" });
  hudEl.append(layerEl);
  const layerControl = createLayerControl(layerEl, (row, on) => {
    // A RAIL layer's row is now the ONLY control for it (2026-10-01: the rail's
    // layer icons were removed — Cyrus: "堆icon panel is abundant"). So the row
    // drives the same `toggleLayer` path the rail button used to, including the
    // persisted `layerOn` set that `?layers=` is built from. It must NOT be
    // handled by the visibility-only path below: a rail layer that was never
    // drawn has no MapLibre layer to hide, so a row click would do nothing.
    if (row.kind === "rail" && row.railId) {
      if (on) layerOn.add(row.railId);
      else layerOn.delete(row.railId);
      writeLayerState();
      void toggleLayer(row.railId, on);
      layerControl.syncRail([...layerOn]);
      return;
    }
    // A vertical row: visibility only. The mode still owns WHICH layers exist,
    // the user owns which are shown. No re-fetch, no mutation of the layer set.
    for (const id of row.mapLayerIds) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    }
  });
  // NOTE: the ✕ on a LAYERS row needs no wiring here. It calls this same
  // `onToggle(row, false)` to switch the layer off and then drops the row, so the
  // checkbox, the ✕ and the rail button all go through one implementation of
  // "off". An earlier draft of this change added a second `onDismiss` path for it,
  // which would have been a second place for the three to disagree.

  // ---- 2D / 3D VIEW SWITCH ---------------------------------------------------

  /** The MapLibre layer ids a single registry layer owns once drawn. */
  function mapIdsFor(def: LayerDefRaw): string[] {
    if (def.geom === "polygon") return [`vl-${def.id}-fill`, `vl-${def.id}-line`, `vl-${def.id}-label`];
    if (def.geom === "point" && (def.source.includes("td_camera") || def.source.includes("hko_webcam"))) {
      const prefix = def.source.includes("hko") ? "cameras-hko" : "cameras-td";
      return [`${prefix}-cluster`, `${prefix}-count`, `${prefix}-point`];
    }
    if (def.geom === "point" && def.source === "wsd_water_suspension") {
      // The water pins are a bespoke ALS join drawn by `drawWaterPoints()`, which
      // names its layer `-points` (PLURAL) rather than `-point`. Without this the
      // LAYERS row would own an id that does not exist, and the row's visibility
      // toggle would silently do nothing — the same dead-control bug the
      // control-point row had.
      return [`vl-${def.id}-points`];
    }
    if (def.geom === "point") return [`vl-${def.id}-circle`, `vl-${def.id}-count`, `vl-${def.id}-point`];
    if (def.geom === "line") return [`vl-${def.id}-line`];
    if (def.geom === "raster") return [`vl-${def.id}-fill`];
    // `poi` (curated reference POIs, drawn by controlPointLayer) does NOT use the
    // `-point`/`-label` suffix scheme — it adds the BARE id plus `-label`. Missing
    // this branch is why the 出入境管制站 row in the LAYERS control was a DEAD
    // control: `mapLayerIds` came back empty, so clicking the row ran a loop over
    // nothing and the pins could not be hidden from the panel at all (measured
    // 2026-09-25). `overlays.ts` `layersOf()` had the mirror-image bug and left
    // the bare layer orphaned on the map; both are fixed together because both
    // come from assuming the suffix scheme is universal.
    if (def.geom === "poi") return [`vl-${def.id}`, `vl-${def.id}-label`];
    return [];
  }

  // Kept so a language switch can relabel the control without rebuilding it —
  // a rebuild would silently reset every toggle to "on".
  let currentLayerRows: LayerRow[] = [];

  /** MapLibre layer ids owned by a RAIL toggle.
   *
   * The rail carries two kinds of toggle. Most correspond to a layers.json
   * definition (aircraft, wind_field, weather_stations, rain_nowcast). One does
   * not: `imagery` swaps the BASEMAP raster, so
   * it has no `vl-` layer of its own. It is listed here anyway because
   * the control's job is to describe what the USER can switch, not only what
   * layers.json happens to define. */
  function railMapIds(id: string): string[] {
    switch (id) {
      case "cameras_td":
        return ["cameras-td-cluster", "cameras-td-count", "cameras-td-point"];
      case "cameras_hko":
        return ["cameras-hko-cluster", "cameras-hko-count", "cameras-hko-point"];
      case "imagery":
        return ["landsd-imagery"];
      default: {
        const def = registry.layers.find((l) => l.id === id);
        return def ? mapIdsFor(def) : [];
      }
    }
  }

  /** The RAIL's own label for a layer id, falling back to layers.json's title.
   *  The rail label is the one the user just read on the button, so reusing it
   *  keeps the two in step. */
  function railLabel(id: string, fallback: { tc: string; en: string }): { tc: string; en: string } {
    return RAIL_LAYERS.find((l) => l.id === id)?.label ?? fallback;
  }

  function paintLegend(layerIds: string[]): void {
    // 1. The vertical's OWN layers (drawn because the mode asked for them).
    const rows: LayerRow[] = layerIds
      .map((lid) => registry.layers.find((l) => l.id === lid))
      .filter((d): d is LayerDefRaw => !!d && d.geom !== "none")
      .map((def) => {
        const src = registry.byId.get(def.source);
        return {
          def,
          mapLayerIds: mapIdsFor(def),
          sourceName: sourceLabel(src, def.source),
          sourceUrl: src?.url,
          kind: "vertical" as const,
        };
      });

    // 2. The RAIL's toggles. Without these the control is a vertical-layer list
    //    wearing the name of a layer control: a user who turns 風場 on from the
    //    rail had no way to see or switch it off from the map's own control
    //    (measured — the panel showed only 停水受影響地區 while four other
    //    layers were on).
    for (const rl of RAIL_LAYERS) {
      if (rows.some((r) => r.def.id === rl.id)) continue; // already listed above
      const def = registry.layers.find((l) => l.id === rl.id);
      const src = def ? registry.byId.get(def.source) : undefined;
      const synthetic: LayerDefRaw = def ?? {
        id: rl.id,
        source: "",
        render: "",
        geom: "raster",
        title: rl.label,
        popup: null,
      };
      rows.push({
        def: synthetic,
        mapLayerIds: railMapIds(rl.id),
        sourceName: sourceLabel(src, lang() === "tc" ? rl.label.tc : rl.label.en),
        sourceUrl: src?.url,
        kind: "rail",
        railId: rl.id,
        label: railLabel(rl.id, synthetic.title),
      });
    }

    currentLayerRows = rows;
    layerControl.setRows(rows);
    layerControl.syncRail(railOn());
  }

  const ctx = { registry, raster: browserRasterizer };
  const triggerState: State = {};
  let currentMode = "overview";
  // TRUE from the first paint, which is Cyrus's decision of 2026-10-01: "我想user
  // 一入就set default 模式 總覽". It used to be false, and with false the trigger
  // engine switched the dashboard into 停水模式 the moment a 食水 notice was in
  // force — measured today: a fresh load opened on water_supply with 2 panels
  // instead of the overview's 18. The signal is still delivered, it just arrives
  // as the same "偵測到：停水模式 / 切換" card a returning user gets, so the reader
  // decides whether the city's water is their question. Auto-switching is right
  // for an emergency broadcast; this is a dashboard the user opens on purpose.
  let userPinned = true;
  let pendingVertical: VerticalDefRaw | null = null;
  // Districts that currently have a live suspension — the map layer tints
  // exactly these, so the polygon layer and the panel cannot disagree.
  let activeDistricts = new Set<string>();
  // The geocoded locations of those same notices. Kept beside the district set
  // because the map draws BOTH: pins say WHERE, the tint says how large the
  // affected area is. Cyrus 2026-09-24: the layer used to tint a whole district
  // for an outage that was one building.
  let waterPoints: WaterPoint[] = [];
  let drawnLayers: LayerDefRaw[] = [];
  let currentLayerIds: string[] = [];
  // Generation token: applyModeLayers is async (CSDI fetch); a mode switch
  // while a previous apply is in flight must not let the stale result paint
  // orphan layers over the new mode (measured: violet district mesh survived
  // into overview/typhoon/border). Every apply bumps the token and checks it
  // before the slow fetch's result is applied.
  const modeGen = { current: 0 };

  const emit = (sourceId: string, value: unknown) => {
    triggerState[sourceId] = value;
    if (sourceId === "wsd_water_suspension") {
      // MEASURED 2026-09-24: this used `records`, which is EVERY active notice
      // — and of 149 records that day, 116 were 供水已恢復 (already restored)
      // and 25 were 停水仍未開始 (not yet started). Highlighting those painted
      // most of Kowloon red on the OVERVIEW, where it reads as a live emergency
      // while the water is in fact back on. The layer is titled 「停水受影響
      // 地區」 — districts WITH suspensions — so it must mean that and nothing
      // more: only notices whose supply is out right now.
      // The panel still lists every active notice (including restored ones
      // with their timestamps, which is useful history); the map is a claim
      // about NOW, and the two are allowed to differ for that reason.
      const records = (value as { records?: { district?: string; status?: string }[] } | undefined)?.records ?? [];
      const nowDistricts = records.filter((r) => r.status === "現正停水").map((r) => r.district);
      const next = new Set(nowDistricts.filter((d): d is string => !!d));
      // The geocoded pins, straight from the adapter (which already filtered to
      // the notices that are out NOW). Comparing by id means a refresh that
      // changed only an address still triggers a redraw.
      const nextPoints = (value as { points?: WaterPoint[] } | undefined)?.points ?? [];
      const pointsChanged =
        nextPoints.length !== waterPoints.length || nextPoints.some((p, i) => waterPoints[i]?.id !== p.id);
      const changed =
        next.size !== activeDistricts.size || [...next].some((d) => !activeDistricts.has(d)) || pointsChanged;
      if (changed) {
        activeDistricts = next;
        waterPoints = nextPoints;
        // Re-draw only if the 停水 layer is on screen, and only when something
        // actually changed — this runs on every panel refresh otherwise.
        if (currentLayerIds.includes("water_suspension_districts")) void applyModeLayers(currentLayerIds);
      }
    }
    // Coverage line follows panel health. Called from emit() because a panel
    // reporting its trigger state is exactly the moment its honesty changed.
    paintCoverage();
  };

  /** The 狀態 cell reports the SYSTEM, which is what its label says.
      It used to be driven by one source (wsd_water_suspension): a single 停水
      notice whose records were all older than the trigger's 30-minute barrier
      made the whole dashboard read 「資料過期」 while every other source was
      healthy — measured, and the most misleading thing on the screen.
      Per-source freshness is not lost: it is in that source's own panel, in its
      panel footer timestamp, and in the coverage line, which counts it per source. */
  function paintStatus(): void {
    const s = engine.stats();
    if (s.error > 0) statusbar.setFreshness(lang() === "tc" ? `${s.error} 個源出錯` : `${s.error} failing`, "bad");
    else if (s.stale > 0) statusbar.setFreshness(lang() === "tc" ? `${s.stale} 個源過期` : `${s.stale} stale`, "warn");
    else if (s.total === 0) statusbar.setFreshness(lang() === "tc" ? "載入中" : "loading", "ok");
    else statusbar.setFreshness(lang() === "tc" ? "正常" : "nominal", "ok");
  }

  /** Honest coverage readout. `total` counts the SOURCES behind the mounted
      panels (the engine dedupes by source), so the figure describes what is on
      screen right now rather than a fixed promise about the catalog.

      Repaints the status cell first: the two are views of the same tally and
      must never be able to disagree. The panel bodies have their OWN 30s tick in
      ui/panels.ts, so a panel footer and this line can differ by up to one tick
      by design. */
  function paintCoverage(): void {
    const s = engine.stats();
    paintStatus();
    statusbar.setCoverage({
      live: s.live,
      total: s.total,
      error: s.error,
      stale: s.stale,
      catalog: registry.sources.length,
    });
  }
  // Staleness is a function of time, so the coverage line needs its own tick —
  // otherwise a source that dies quietly keeps reading "healthy" until some
  // unrelated panel happens to refresh.
  window.setInterval(paintCoverage, 30_000);

  const engine = createPanelEngine({
    root: panelsEl,
    onHiddenChange: (ids) => paintRestore(ids),
    registry,
    ctx,
    cameras,
    tilesVia: manifest.tilesVia,
    onWallImage: (img) => {
      if (img.video) {
        // A live-stream tile plays in the drawer; a dead one says so there.
        drawer.openVideo({ id: img.video.id, title: img.name, channel: img.video.channel, live: img.video.live });
        return;
      }
      const cam = [...cameras.td, ...cameras.hko].find((c) => c.id === img.id);
      if (cam) drawer.openCamera(cam);
    },
    onState: emit,
  });

  /** The way back from a hidden panel. A preference with no visible way to undo
      it is a trap, and "hidden" must never be indistinguishable from "broken". */
  function paintRestore(ids: string[]): void {
    clear(panelRestoreEl);
    panelRestoreEl.hidden = ids.length === 0;
    // Coverage counts what is ON SCREEN, so it has to be repainted from here —
    // this is the single place both a change and the boot state come through.
    paintCoverage();
    if (ids.length === 0) return;
    panelRestoreEl.append(
      h("span", {}, lang() === "tc" ? `已隱藏 ${ids.length} 個面板` : `${ids.length} panel(s) hidden`),
      h(
        "button",
        {
          type: "button",
          onclick: () => {
            for (const id of engine.hiddenIds()) engine.setPanelHidden(id, false);
          },
        },
        lang() === "tc" ? "還原全部" : "Restore all",
      ),
    );
  }

  // --- category tabs ------------------------------------------------------------
  // The tab set is the `group` field of the SOURCES behind the panels the current
  // mode mounted — derived, never a second hand-kept list. A mode that mounts no
  // transport panel simply has no transport tab.
  let currentTab: string | null = new URLSearchParams(location.search).get("tab");

  function writeTab(): void {
    const url = new URL(location.href);
    if (currentTab === null) url.searchParams.delete("tab");
    else url.searchParams.set("tab", currentTab);
    history.replaceState(null, "", url);
  }

  const groupTabs = createGroupTabs(panelTabsEl, (id) => {
    currentTab = id;
    applyTab();
  });

  /** One place where a tab change becomes visible: the filter, the chip state,
      the shareable URL and the coverage line all move together. The coverage
      repaint is not cosmetic — the number describes what is on screen, so
      leaving it at the unfiltered figure would overstate the system's health
      exactly while the user is looking at two panels. */
  function applyTab(): void {
    engine.setGroupFilter(currentTab);
    groupTabs.setActive(currentTab);
    writeTab();
    paintCoverage();
  }

  function refreshTabs(): void {
    const counts = new Map<string, number>();
    for (const id of engine.currentIds()) {
      const panel = registry.panels.find((p) => p.id === id);
      const g = panel ? registry.byId.get(panel.source)?.group : undefined;
      if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
    const tabs: GroupTab[] = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id, count]) => ({ id, label: labelFor(id), count }));
    // A tab this mode does not have must not stay selected, or the panels would
    // be filtered by a category the user can no longer see or clear.
    if (currentTab !== null && !counts.has(currentTab)) currentTab = null;
    groupTabs.setTabs(tabs, currentTab);
    applyTab();
    // One tab is not a choice; hide the strip rather than show a fake control.
    panelTabsEl.hidden = tabs.length < 2;
  }

  // verticals.json is validated to the closed trigger syntax by
  // scripts/validate_config.py; the cast is the JSON→type boundary.
  const verticals = registry.verticals as unknown as VerticalDef[];

  // --- layer state: the map, the shareable URL and the next visit agree --------
  // World Monitor's rule (its map-layers feature doc): toggling one layer must
  // change the map, update the shareable URL and be remembered next visit.
  // Precedence URL > localStorage > the RAIL_LAYERS defaults, so a shared link
  // always beats the recipient's own saved settings.
  const LAYER_KEY = "hkcm.layers";
  const DEFAULT_ON = RAIL_LAYERS.filter((l) => l.on).map((l) => l.id).sort().join(",");
  const isRailLayer = (id: string): boolean => RAIL_LAYERS.some((l) => l.id === id);

  function readLayerState(): Set<string> {
    const fromUrl = new URLSearchParams(location.search).get("layers");
    // A URL is a trust boundary: unknown ids are dropped here rather than
    // reaching toggleLayer and raising a banner about a layer that cannot exist.
    if (fromUrl !== null) return new Set(fromUrl.split(",").filter(isRailLayer));
    try {
      const raw = localStorage.getItem(LAYER_KEY);
      if (raw) return new Set((JSON.parse(raw) as string[]).filter(isRailLayer));
    } catch {
      /* private mode — fall through to the defaults */
    }
    return new Set(RAIL_LAYERS.filter((l) => l.on).map((l) => l.id));
  }

  function writeLayerState(): void {
    const on = RAIL_LAYERS.map((l) => l.id).filter((id) => layerOn.has(id)).sort();
    try {
      localStorage.setItem(LAYER_KEY, JSON.stringify(on));
    } catch {
      /* non-persistent is acceptable; the toggle still works for the session */
    }
    const url = new URL(location.href);
    // A clean URL stays clean: serialise only when it differs from the default.
    if (on.join(",") === DEFAULT_ON) url.searchParams.delete("layers");
    // An empty set needs a word: `?layers=` reads as a truncated link, and a
    // shared URL that looks broken gets edited by hand. "none" parses back to
    // the empty set for free (the isRailLayer filter drops it).
    else url.searchParams.set("layers", on.length > 0 ? on.join(",") : "none");
    history.replaceState(null, "", url);
  }

  const layerOn = readLayerState();
  // Vertical labels come from the registry so a language switch relabels the picker with
  // everything else; the control is rebuilt rather than patched, because ten options is
  // cheaper to rebuild than to reconcile.
  // 總覽 is not a vertical — the rail synthesised it, and deleting the rail took the entry
  // with it. MEASURED on the live build 2026-10-01: the picker held ten options and NOT ONE
  // matched `currentMode()`, so it displayed the first vertical (typhoon) while the app was in
  // 總覽. The same shape error had a second face: the field in verticals.json is `name`, not
  // `label`, and a wrong key falls through to the id — which is why the options read
  // "water_supply" instead of 停水模式, looking like a deliberate choice rather than a miss.
  // Rebuilt here exactly as rail.ts built it, including the vertical's question as the title.
  const modeOptions = (): { id: string; label: string; title?: string }[] => [
    { id: "overview", label: lang() === "tc" ? "總覽" : "Overview" },
    ...registry.verticals.map(
      (v: { id: string; name?: Record<string, string>; question?: Record<string, string> }) => ({
        id: v.id,
        label: v.name?.[lang()] ?? v.id,
        title: (lang() === "tc" ? v.question?.tc : v.question?.en) ?? "",
      }),
    ),
  ];
  const wireModes = () => statusbar.setModes(modeOptions(), (id) => activateMode(id, true));
  wireModes();
  // The picker has to agree with the state it reports. Boot leaves `currentMode` at its default
  // without going through activateMode, so nothing had told the control which value is live —
  // measured 2026-10-01: the select showed 颱風 while the app was in 總覽. A control that shows a
  // mode the app is not in is worse than no control (Hard rule 1: every claim is traceable).
  statusbar.setMode(currentMode);

  /** Layer ids currently on. `layerOn` is the single source of truth now that the
   *  rail's own layer buttons are gone — before, this read them back from the
   *  rail's `aria-pressed`, which was a second copy of the same fact. */
  function railOn(): string[] {
    return [...layerOn];
  }

  /** Banner: a bold one-line title (what happened) plus an optional dim detail
    line (why it matters). The trigger banner used to cram the whole vertical
    question into the title, which read as a wall of text over the map. */
  function showBanner(title: string, action: { label: string; run: () => void } | null, detail = ""): void {
    clear(banner);
    banner.style.display = "";
    banner.append(
      h(
        "div",
        { class: "panel-head", style: "margin-bottom:4px" },
        h("h2", { title }, title),
        action ? h("button", { class: "chip stale", type: "button", onclick: action.run }, action.label) : h("span", {}),
      ),
      detail ? h("p", { class: "banner-detail" }, detail) : "",
    );
  }

  function hideBanner(): void {
    banner.style.display = "none";
    clear(banner);
  }

  /** Draw exactly the layers a vertical names — from layers.json, nothing else. */
  async function applyModeLayers(layerIds: string[]): Promise<void> {
    const gen = ++modeGen.current;
    currentLayerIds = layerIds;
    clearVerticalLayers(map, drawnLayers);
    drawnLayers = [];
    const defs = layerIds
      .map((lid) => registry.layers.find((l) => l.id === lid))
      .filter((l): l is LayerDefRaw => !!l);
    try {
      // The gen check travels with the slow fetch: the layer code throws a
      // sentinel when a newer mode apply has already started.
      const drawn = await applyVerticalLayers(map, defs, { registry, ctx, activeDistricts, waterPoints, triggerState, gen, isCurrent: (g) => g === modeGen.current });
      if (gen !== modeGen.current) return; // superseded — nothing to record
      drawnLayers = defs.filter((d) => drawn.includes(d.id));
      paintLegend(drawnLayers.map((d) => d.id));
    } catch (err) {
      if (gen !== modeGen.current) return; // stale failure — ignore
      const msg = err instanceof Error ? err.message : String(err);
      showBanner(lang() === "tc" ? `圖層出錯：${msg}` : `Layer error: ${msg}`, {
        label: lang() === "tc" ? "閂" : "Dismiss",
        run: hideBanner,
      });
      console.warn(`[hkcm] vertical layers failed: ${msg}`);
    }
  }

  function activateMode(id: string, manual: boolean): void {
    currentMode = id;
    if (manual) {
      userPinned = true;
      // A manual choice moots the auto-switch notice — never leave a stale
      // "自動切換" card telling the user to do what they just did.
      hideBanner();
    }
    statusbar.setMode(id);
    const v = registry.verticals.find((x) => x.id === id);
    statusbar.setMode(
      v ? (lang() === "tc" ? v.name.tc : v.name.en) : lang() === "tc" ? "總覽" : "Overview",
    );
    mapHead.setScope(v ? v.name.tc : "香港實時情況", v ? v.name.en : "HONG KONG LIVE");
    engine.setPanels(v ? v.order : OVERVIEW);
    refreshTabs();
    void applyModeLayers(v ? v.layers : []);
    if (manual && pendingVertical?.id === id) {
      pendingVertical = null;
      hideBanner();
    }
  }

  function evaluateTriggers(): void {
    const hits = activeVertical(triggerState, verticals);
    if (!hits || hits === currentMode) {
      if (!hits) hideBanner();
      return;
    }
    const v = registry.verticals.find((x) => x.id === hits);
    if (!v) return;
    if (!userPinned) {
      // No human choice to respect yet: switch, and say why.
      activateMode(hits, false);
      showBanner(
        lang() === "tc" ? `自動切換：${v.name.tc}` : `Auto-switched: ${v.name.en}`,
        { label: lang() === "tc" ? "轉返總覽" : "Back to overview", run: () => { userPinned = true; activateMode("overview", true); } },
      );
      return;
    }
    // The user picked a mode; a trigger still gets to ask, not to decide.
    pendingVertical = v;
    showBanner(
      lang() === "tc" ? `偵測到：${v.name.tc}` : `Detected: ${v.name.en}`,
      { label: lang() === "tc" ? "切換" : "Switch", run: () => activateMode(v.id, true) },
      lang() === "tc" ? v.question.tc : v.question.en,
    );
  }

  // --- trigger polling, independent of panel visibility ----------------------
  async function pollTriggers(): Promise<void> {
    // The trigger-relevant sources, HAND-LISTED ON PURPOSE.
    //
    // This is the one fetch that runs even when the source's panel is hidden or
    // unmounted, so it must stay a short, reviewed set rather than "everything a
    // vertical mentions" — otherwise a background loop quietly polls the whole
    // registry. The consequence is a coupling to remember: adding a vertical in
    // verticals.json whose trigger reads a NEW source also means adding that
    // source here, or the trigger can never fire in the background. The
    // alternative (deriving the list from verticals.json) was rejected because
    // some verticals reference sources only for their panels, not their triggers,
    // and polling those unconditionally is exactly the cost this list avoids.
    for (const sourceId of ["hko_warnsum", "wsd_water_suspension"]) {
      const panel = registry.panels.find((p) => p.source === sourceId);
      if (!panel) continue;
      try {
        const { state } = await adaptPanel(panel, ctx);
        if (state !== undefined) emit(sourceId, state);
      } catch {
        // A trigger source that fails must not silently clear a warning that is
        // still in force: keep the last known state and let the panel's own
        // error state tell the user. (Clearing here would be the dangerous
        // direction — it would drop a live rainstorm warning.)
      }
    }
    evaluateTriggers();
  }

  // --- map layer toggles ------------------------------------------------------
  // The rail toggles operate on the same layers.json definitions a vertical
  // uses — one definition, one renderer, whether the user or the config asked.
  async function toggleLayer(id: string, on: boolean): Promise<void> {
    try {
      switch (id) {
        case "cameras_td":
          for (const suffix of ["cluster", "count", "point"]) {
            // Guarded: a click in the first second after boot, before the style
            // has landed, must be a no-op rather than a layer error banner.
            const lid = `${TD_SRC}-${suffix}`;
            if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", on ? "visible" : "none");
          }
          break;
        case "cameras_hko":
          for (const suffix of ["cluster", "count", "point"]) {
            const lid = `${HKO_SRC}-${suffix}`;
            if (map.getLayer(lid)) map.setLayoutProperty(lid, "visibility", on ? "visible" : "none");
          }
          break;
        case "imagery":
          setBasemap(map, on ? "imagery" : "topo");
          break;
        case "esri_topo":
          setBasemap(map, on ? "esri-topo" : "topo");
          break;
        case "esri_gray":
          setBasemap(map, on ? "esri-gray" : "topo");
          break;
        case "rain_nowcast": {
          // Same layers.json definition the 颱風模式 vertical uses — one
          // definition, one renderer, whether the user or the config asked.
          const def = registry.layers.find((l) => l.id === "rain_nowcast");
          if (!def) throw new Error("layers.json 冇 rain_nowcast");
          clearVerticalLayers(map, [def]);
          if (!on) break;
          const drawn = await applyVerticalLayers(map, [def], { registry, ctx, activeDistricts, waterPoints });
          if (!drawn.includes("rain_nowcast")) throw new Error("降雨圖層畫唔出");
          break;
        }
        case "aircraft": {
          // UNREACHABLE while the rail entry is commented out (see RAIL_LAYERS).
          // Kept deliberately: the toggle path is the non-obvious half of this
          // feature, and deleting it would mean re-deriving it from layers.json
          // when a source that tolerates cloud egress is found. It throws
          // loudly rather than silently no-op'ing, so a mistaken re-enable is
          // caught rather than half-working.
          const def = registry.layers.find((l) => l.id === "aircraft");
          if (!def) throw new Error("layers.json 冇 aircraft（圖層已撤回，見 RAIL_LAYERS 註解）");
          clearVerticalLayers(map, [def]);
          if (!on) break;
          const drawn = await applyVerticalLayers(map, [def], { registry, ctx, activeDistricts, waterPoints });
          if (!drawn.includes("aircraft")) throw new Error("航機圖層畫唔出");
          break;
        }
        case "mtr_trains": {
          const def = registry.layers.find((l) => l.id === "mtr_trains");
          if (!def) throw new Error("layers.json 冇 mtr_trains");
          clearVerticalLayers(map, [def]);
          if (!on) break;
          const drawn = await applyVerticalLayers(map, [def], { registry, ctx, activeDistricts, waterPoints });
          if (!drawn.includes("mtr_trains")) throw new Error("港鐵列車圖層畫唔出");
          break;
        }
        case "wind_field": {
          // WIND FLOW, not station barbs (Cyrus 2026-09-25).
          //
          // The old barb layer drew ~30 real observations with a distance
          // fade-out. Honest, but it answers "what is the wind at this
          // instrument", not "where is the air going" — and a flow animation is
          // what a reader actually reads off a weather map. It now runs a GPU
          // particle animation over the MODELLED Open-Meteo lattice
          // (map/wind.ts), while the CSDI station layer keeps drawing OBSERVED
          // readings; the legend distinguishes the two.
          //
          // No MapLibre layer is created, so there is nothing for
          // clearVerticalLayers to remove — visibility is the deck.gl overlay's,
          // exactly like the 3D layer.
          const src = registry.byId.get("open_meteo_wind_grid");
          await toggleWind(map, on, src);
          break;
        }        case "weather_stations": {
          // A STATIC reference layer (CSDI snapshot), so it follows the same
          // config path as everything else rather than a bespoke branch.
          const def = registry.layers.find((l) => l.id === "weather_stations");
          if (!def) throw new Error("layers.json 冇 weather_stations");
          clearVerticalLayers(map, [def]);
          if (!on) break;
          const drawn = await applyVerticalLayers(map, [def], { registry, ctx, activeDistricts, waterPoints });
          if (!drawn.includes("weather_stations")) throw new Error("氣象站圖層畫唔出");
          break;
        }
        case "aed_locations": {
          // Same config path as every other point layer; the clustering lives in overlays.ts's
          // pointLayer and needs nothing here.
          const def = registry.layers.find((l) => l.id === "aed_locations");
          if (!def) throw new Error("layers.json 冇 aed_locations");
          clearVerticalLayers(map, [def]);
          if (!on) break;
          const drawn = await applyVerticalLayers(map, [def], { registry, ctx, activeDistricts, waterPoints });
          if (!drawn.includes("aed_locations")) throw new Error("AED 圖層畫唔出");
          break;
        }
        case "drone_rfz": {
          // Config-driven like rain_nowcast and weather_stations: one layers.json definition, one
          // renderer. The polygon support itself lives in map/overlays.ts (`polygonLayer`).
          //
          // The guard below is not decoration. `applyVerticalLayers` catches per-layer failures and
          // re-throws, but a layer that draws NOTHING returns normally — and a toggle that turns on,
          // reports success and paints no polygons is the dead-control failure this project has hit
          // three times. So the drawn list is checked rather than the absence of a throw.
          const def = registry.layers.find((l) => l.id === "drone_rfz");
          if (!def) throw new Error("layers.json 冇 drone_rfz");
          clearVerticalLayers(map, [def]);
          if (!on) break;
          const drawn = await applyVerticalLayers(map, [def], { registry, ctx, activeDistricts, waterPoints });
          if (!drawn.includes("drone_rfz")) throw new Error("無人機禁飛區圖層畫唔出");
          break;
        }
        default: {
          // ONE generic path for any layers.json entry the renderer knows how to draw.
          //
          // aed_locations and drone_rfz each carry a hand-written block doing these same four
          // steps, and the facility layers would have been the third and fourth copies. Three
          // copies of eight lines is a pattern; adding two more is the point where the
          // duplication is the bug rather than the fix. The `if (!def) throw` below keeps the
          // failure loud for an id that is NOT in layers.json, which is what `default:` was
          // guarding and is the part worth keeping.
          const def = registry.layers.find((l) => l.id === id);
          if (!def) throw new Error(`unknown layer ${id}`);
          clearVerticalLayers(map, [def]);
          if (!on) break;
          // The drawn list is checked, not the absence of a throw: a layer that draws NOTHING
          // returns normally, and a toggle that turns on, reports success and paints nothing is
          // the dead-control failure this project has hit three times.
          const drawn = await applyVerticalLayers(map, [def], { registry, ctx, activeDistricts, waterPoints });
          if (!drawn.includes(id)) throw new Error(`圖層 ${id} 畫唔出`);
          break;
        }
      }
    } catch (err) {
      // A layer that cannot load says so in the banner below — the rail button it
      // used to also colour red is gone, and the banner is the honest report: with
      // the network off this is the 3D error state, never a blank scene.
      const msg = err instanceof Error ? err.message : String(err);
      showBanner(lang() === "tc" ? `圖層開唔到：${id}` : `Layer failed: ${id}`, {
        label: lang() === "tc" ? "閂" : "Dismiss",
        run: hideBanner,
      });
      console.warn(`[hkcm] layer ${id} failed: ${msg}`);
    }
  }

  // --- online / offline -------------------------------------------------------
  // The brand dot is gone (Cyrus 2026-10-02). Offline is now shown on the coverage line,
  // which is always in the DOM, so this is a plain lookup instead of an asserted one.
  const pulse = document.querySelector<HTMLElement>(".coverage");
  window.addEventListener("offline", () => {
    pulse?.classList.add("off");
    engine.refreshAll(); // every panel that cannot answer goes to its error state
  });
  window.addEventListener("online", () => {
    pulse?.classList.remove("off");
    engine.refreshAll();
    void pollTriggers();
  });

  // --- go ---------------------------------------------------------------------
  activateMode("overview", false);
  // Paint the hidden state from storage: without this a reload shows the hidden
  // panels gone and no restore chip, which makes hiding a one-way door.
  paintRestore(engine.hiddenIds());
  // Replay the remembered state now the map exists.
  // addCameraLayers() has ALREADY drawn both camera layers as visible, so a
  // remembered state that excludes one has to say so explicitly: replaying only
  // the ON layers leaves an un-asked-for layer on the map (measured — the URL
  // said ?layers=aircraft while cameras-hko-point was still "visible").
  // Only the default-ON layers are replayed as OFF; imagery / 3D are left alone
  // so a boot can never fire a layer error banner for something never asked for.
  const replayLayerState = (): void => {
    for (const l of RAIL_LAYERS) {
      const want = layerOn.has(l.id);
      if (want || l.on) void toggleLayer(l.id, want);
    }
  };
  // The camera layers attach on the map's `load` event (cameras.ts — the `load`
  // event is the only honest signal that the style has landed), so replaying
  // before it asks for layers that do not exist yet.
  if (map.getStyle()) replayLayerState();
  else map.once("load", replayLayerState);
  drawer.close();
  // ⌘K command palette — jump to any mode / panel / camera.
  createPalette({
    registry,
    cameras,
    onMode: (id) => activateMode(id, true),
    onCamera: (cam) => {
      map.flyTo({ center: [cam.lon, cam.lat], zoom: 15, duration: 600 });
      drawer.openCamera(cam);
    },
    currentMode: () => currentMode,
  });
  void pollTriggers();
  window.setInterval(() => void pollTriggers(), TRIGGER_POLL_MS);

  (window as unknown as Record<string, unknown>)["__hkcm"] = {
    registry,
    triggerState,
    currentMode: () => currentMode,
    /** districts the map layer is highlighting right now — QA reads this
        instead of guessing from a screenshot */
    activeDistricts: () => [...activeDistricts],
    drawnLayers: () => [...currentLayerIds],
    /** layers the user currently has ON — QA reads this instead of guessing
        from the rail's aria-pressed state */
    layersOn: () => RAIL_LAYERS.map((l) => l.id).filter((id) => layerOn.has(id)),
    /** the selected category tab, or null for 全部 */
    currentTab: () => currentTab,
    hiddenPanels: () => engine.hiddenIds(),
    /** the tabs the current mode offers — QA reads this instead of counting
        chips in a screenshot */
    tabs: () => [...panelTabsEl.querySelectorAll(".ptab")].map((b) => (b as HTMLElement).dataset["group"] ?? ""),
    layerDefaults: () => RAIL_LAYERS.filter((l) => l.on).map((l) => l.id),
    /** the panels the overview mode shows — QA compares against this instead of
        a hardcoded count, so adding a panel is not reported as a failure */
    overviewIds: () => [...OVERVIEW],
    /** drop the 30s payload memo — QA uses this to force a true refetch
        (e.g. the offline / source-down honesty checks) */
    clearDataCache: () => clearDataCache(),
    refreshAll: () => engine.refreshAll(),
    hasWorker: hasWorker(),
    workerBase: WORKER_BASE,
    minRefreshMs: MIN_REFRESH_MS,
    lang,
    t,
  };
  document.body.dataset["ready"] = "1";
}

/**
 * Drag the panel column's left edge to size it (Cyrus 2026-10-02). The width lives in a custom
 * property the grid track already reads, so this only has to write one value — there is no
 * second layout model to keep in sync. Bound to the document because the grip is a pseudo-element
 * and the column is created during boot: a listener on the element would have to race boot.
 */
function initColumnResize(): void {
  const KEY = "hkcm.panelWidth";
  const root = document.documentElement;
  // Stored as a percentage of the viewport, because a px width remembered on a desktop makes the
  // map useless on a phone, and the reader's intent is "this much of the screen".
  const saved = Number(localStorage.getItem(KEY));
  if (saved >= 20 && saved <= 96) root.style.setProperty("--panel-w", `${saved}vw`);
  let dragging = false;
  document.addEventListener("pointerdown", (e) => {
    const col = document.getElementById("panelCol");
    if (!col || !(e.target instanceof Element)) return;
    const r = col.getBoundingClientRect();
    if (Math.abs(e.clientX - r.left) > 6) return;
    dragging = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  document.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const vw = Math.min(96, Math.max(20, ((window.innerWidth - e.clientX) / window.innerWidth) * 100));
    root.style.setProperty("--panel-w", `${vw.toFixed(1)}vw`);
  });
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    const v = parseFloat(getComputedStyle(root).getPropertyValue("--panel-w"));
    if (v >= 20 && v <= 96) localStorage.setItem(KEY, String(Math.round(v)));
  };
  document.addEventListener("pointerup", stop);
  document.addEventListener("pointercancel", stop);
}
initColumnResize();

boot().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.append(
    h("div", { class: "panel is-error", style: "position:fixed;inset:auto 12px 12px auto;z-index:99" },
      h("div", { class: "p-error" }, `啟動失敗：${msg}`)),
  );
  console.error("[hkcm] boot failed", err);
});
