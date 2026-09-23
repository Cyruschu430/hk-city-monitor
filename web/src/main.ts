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
import { loadRegistry, clearDataCache, type VerticalDefRaw } from "./lib/sources.ts";
import { createMap, landsdBadge, setBasemap } from "./map/basemap.ts";
import { addCameraLayers, loadCameras, TD_SRC, HKO_SRC, type Camera } from "./map/cameras.ts";
import { applyVerticalLayers, clearVerticalLayers } from "./map/overlays.ts";
import { createLayerControl, relabelLayerControl, type LayerRow } from "./ui/layercontrol.ts";
import { toggle3d } from "./map/overlays3d.ts";
import type { LayerDefRaw } from "./lib/sources.ts";
import { createDrawer } from "./ui/drawer.ts";
import { createPanelEngine } from "./ui/panels.ts";
import { analyse } from "./lib/analytics/index.ts";
import { emptyStore, BASELINE_VERSION, type BaselineStore } from "./lib/analytics/baseline.ts";
import type { RuleDef } from "./lib/analytics/rules.ts";
import { createRail, type RailLayer } from "./ui/rail.ts";
import { createStatusBar } from "./ui/statusbar.ts";
import { createMapHead, relabelMapHead } from "./ui/maphead.ts";
import { createTicker } from "./ui/ticker.ts";
import { createPalette } from "./ui/palette.ts";
import { createFocusHud } from "./ui/focushud.ts";
import { createGroupTabs, labelFor, type GroupTab } from "./ui/grouptabs.ts";

/** The vertical-free default view. Ordered as a World-Monitor-style dense
    wall: imagery heads the column, then life-safety and civic reads. */
const OVERVIEW = [
  "live_cams_wall",
  "warnings_list",
  "breaking_news_list",
  "aircraft_status",
  "wind_status",
  "stations_status",
  "cameras_wall",
  "hko_cameras_wall",
  "special_traffic_list",
  "mtr_next_train_list",
  "kmb_eta_table",
  "tp_queue_grid",
  "hk_market_table",
  "crypto_prices",
  "aqhi_gauge_grid",
  "carpark_vacancy_list",
  "ae_waiting_grid",
  "water_suspension_list",
];

/** Trigger polling: two sources, 3 minutes. The Worker edge-caches 60s, so a
    faster loop would buy nothing. */
const TRIGGER_POLL_MS = 3 * 60_000;

/** How often the Tier 0-4 pipeline re-runs over current state. Faster than the
    trigger poll because this is pure computation over data already in memory —
    a rule can fire the moment a panel reports, without waiting for a fetch. */
const ANALYSIS_INTERVAL_MS = 30_000;

const RAIL_LAYERS: RailLayer[] = [
  { id: "cameras_td", label: { tc: "運輸署相機", en: "TD cameras" }, on: true },
  { id: "cameras_hko", label: { tc: "天文台相機", en: "HKO cameras" }, on: true },
  { id: "aircraft", label: { tc: "航機（ADS-B）", en: "Aircraft (ADS-B)" } },
  { id: "wind_field", label: { tc: "風場", en: "Wind field" } },
  { id: "weather_stations", label: { tc: "氣象站", en: "Weather stations" } },
  { id: "rain_nowcast", label: { tc: "降雨臨近預報", en: "Rain nowcast" } },
  { id: "imagery", label: { tc: "航拍底圖", en: "Aerial basemap" } },
  { id: "buildings3d", label: { tc: "3D 樓宇（載入慢）", en: "3D buildings (heavy)" } },
];

async function boot(): Promise<void> {
  const statusbar = createStatusBar(document.getElementById("statusbar")!);
  const mapHeadEl = document.getElementById("mapHead")!;
  const mapHead = createMapHead(mapHeadEl);
  onLangChange(() => {
    relabelMapHead(mapHeadEl);
    relabelLayerControl(layerEl, currentLayerRows);
  });
  const tickerEl = document.getElementById("ticker")!;
  const railEl = document.getElementById("rail")!;
  const panelsEl = document.getElementById("panels")!;
  const mapEl = document.getElementById("map")!;
  const hudEl = document.getElementById("mapHud")!;
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

  const banner = h("div", { class: "panel", style: "position:absolute;left:12px;top:12px;max-width:420px;display:none" });
  hudEl.append(banner);

  // LAYERS control — replaces the old passive legend. Same registry, so a row
  // cannot describe a layer that is not drawable; unlike the legend it can be
  // toggled, which is what makes the map face an instrument rather than a
  // caption (World Monitor grammar, plan §9.1).
  const layerEl = h("div", { class: "layer-control" });
  hudEl.append(layerEl);
  const layerControl = createLayerControl(layerEl, (row, on) => {
    // Visibility only: the mode still owns WHICH layers exist, the user owns
    // which are shown. No re-fetch, no mutation of the vertical's layer set.
    for (const id of row.mapLayerIds) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    }
  });

  /** The MapLibre layer ids a single registry layer owns once drawn. */
  function mapIdsFor(def: LayerDefRaw): string[] {
    if (def.geom === "polygon") return [`vl-${def.id}-fill`, `vl-${def.id}-line`, `vl-${def.id}-label`];
    if (def.geom === "point" && (def.source.includes("td_camera") || def.source.includes("hko_webcam"))) {
      const prefix = def.source.includes("hko") ? "cameras-hko" : "cameras-td";
      return [`${prefix}-cluster`, `${prefix}-count`, `${prefix}-point`];
    }
    if (def.geom === "point") return [`vl-${def.id}-circle`, `vl-${def.id}-count`, `vl-${def.id}-point`];
    if (def.geom === "raster") return [`vl-${def.id}-fill`];
    return [];
  }

  // Kept so a language switch can relabel the control without rebuilding it —
  // a rebuild would silently reset every toggle to "on".
  let currentLayerRows: LayerRow[] = [];
  function paintLegend(layerIds: string[]): void {
    const rows: LayerRow[] = layerIds
      .map((lid) => registry.layers.find((l) => l.id === lid))
      .filter((d): d is LayerDefRaw => !!d && d.geom !== "none")
      .map((def) => {
        const src = registry.byId.get(def.source);
        return {
          def,
          mapLayerIds: mapIdsFor(def),
          sourceName: src?.name ?? def.source,
          sourceUrl: src?.url,
        };
      });
    currentLayerRows = rows;
    layerControl.setRows(rows);
  }

  const ctx = { registry, raster: browserRasterizer };
  const triggerState: State = {};
  let currentMode = "overview";
  let userPinned = false;
  let pendingVertical: VerticalDefRaw | null = null;
  // Districts that currently have a live suspension — the map layer highlights
  // exactly these, so the polygon layer and the panel cannot disagree.
  let activeDistricts = new Set<string>();
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
      // `records` lists what the panel is already showing (with timestamps);
      // `records_fresh` is what the trigger reads. The map highlights the
      // former, so the map and the panel can never disagree.
      const records = (value as { records?: { district?: string }[] } | undefined)?.records ?? [];
      const next = new Set(records.map((r) => r.district).filter((d): d is string => !!d));
      const changed = next.size !== activeDistricts.size || [...next].some((d) => !activeDistricts.has(d));
      if (changed) {
        activeDistricts = next;
        // Re-draw only if the 停水 layer is on screen, and only when the set
        // actually changed — this runs on every panel refresh otherwise.
        if (currentLayerIds.includes("water_suspension_districts")) void applyModeLayers(currentLayerIds);
      }
    }
    // Coverage line follows panel health. Called from emit() because a panel
    // reporting its trigger state is exactly the moment its honesty changed.
    paintCoverage();
  };

  /** Honest coverage readout. `total` counts the SOURCES behind the mounted
      panels (the engine dedupes by source), so the figure describes what is on
      screen right now rather than a fixed promise about the catalog. */
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

  function paintCoverage(): void {
    const s = engine.stats();
    // Painted together on purpose: the status cell and the coverage line are two
    // views of the same tally, so they must never be able to disagree.
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

  // --- Tier 0-4 analytics ------------------------------------------------------
  // A VIEW over the trigger state the panels have already produced, not a data
  // source of its own. Deterministic rules only — there is no LLM in the browser
  // path, so the brief is always the template wording (Tier 3/4 narrative runs
  // in the offline collector and is read back from data/analysis.json).
  //
  // The baseline store starts EMPTY and is folded from real readings, so on a
  // fresh load it honestly reports "累積中 0/14 日" until a collector persists
  // baselines across days. That is the real state, not a placeholder.
  let baselineStore = emptyStore();

  function runAnalysis(): void {
    const rules = (registry.rules ?? []) as unknown as RuleDef[];
    if (rules.length === 0) return;
    const out = analyse({
      state: triggerState,
      rules,
      store: baselineStore,
      now: new Date(),
      lang: lang(),
      convergence: { windowMinutes: 60, minDomains: 2, maxGroups: 5 },
    });
    baselineStore = out.store;
    engine.setAnalysis(out.brief);
  }
  window.setInterval(runAnalysis, ANALYSIS_INTERVAL_MS);

  // Persisted baselines, when a collector has produced them
  // (scripts/collect_baselines.mjs → data/baselines.json). baseline.ts stores plane
  // JSON keyed "signalId|dow|hour", so this is a read, not a migration.
  // Every failure path keeps the empty store, which the brief then reports honestly
  // as 「累積中 0/14 日」: the one thing a missing file must never do is read as
  // "no anomalies today".
  void fetch("data/baselines.json")
    .then((r) => (r.ok ? (r.json() as Promise<Partial<BaselineStore>>) : null))
    .then((j) => {
      if (!j || j.version !== BASELINE_VERSION || !j.signals || !j.days) return;
      baselineStore = j as BaselineStore;
      runAnalysis();
    })
    .catch(() => {
      /* no collector has run yet — the empty store is the honest state */
    });

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
  const rail = createRail(
    railEl,
    registry.verticals,
    RAIL_LAYERS.map((l) => ({ ...l, on: layerOn.has(l.id) })),
    {
      onMode: (id) => activateMode(id, true),
      onToggleLayer: (id, on) => {
        if (on) layerOn.add(id);
        else layerOn.delete(id);
        writeLayerState();
        void toggleLayer(id, on);
      },
    },
  );

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
      const drawn = await applyVerticalLayers(map, defs, { registry, ctx, activeDistricts, gen, isCurrent: (g) => g === modeGen.current });
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
    rail.setActive(id);
    const v = registry.verticals.find((x) => x.id === id);
    statusbar.setMode(
      v ? (lang() === "tc" ? v.name.tc : v.name.en) : lang() === "tc" ? "總覽" : "Overview",
    );
    mapHead.setScope(v ? v.name.tc : "香港即時態勢", v ? v.name.en : "HONG KONG SITUATION");
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
    rail.setLayerError(id, null);
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
        case "rain_nowcast": {
          // Same layers.json definition the 颱風模式 vertical uses — one
          // definition, one renderer, whether the user or the config asked.
          const def = registry.layers.find((l) => l.id === "rain_nowcast");
          if (!def) throw new Error("layers.json 冇 rain_nowcast");
          clearVerticalLayers(map, [def]);
          if (!on) break;
          const drawn = await applyVerticalLayers(map, [def], { registry, ctx, activeDistricts });
          if (!drawn.includes("rain_nowcast")) throw new Error("降雨圖層畫唔出");
          break;
        }
        case "aircraft": {
          // Same layers.json definition the aircraft panel uses: one definition,
          // one renderer, whether the user or a vertical asked for it. The
          // adapter feeds both, so the map and the panel cannot disagree.
          const def = registry.layers.find((l) => l.id === "aircraft");
          if (!def) throw new Error("layers.json 冇 aircraft");
          clearVerticalLayers(map, [def]);
          if (!on) break;
          const drawn = await applyVerticalLayers(map, [def], { registry, ctx, activeDistricts });
          if (!drawn.includes("aircraft")) throw new Error("航機圖層畫唔出");
          break;
        }
        case "wind_field": {
          // Wind barbs: only where a station measured it, fading to nothing by
          // ~15km (ROADMAP B5). The fade is baked into each feature by the
          // adapter, so the honesty rule is data, not a styling choice.
          const def = registry.layers.find((l) => l.id === "wind_field");
          if (!def) throw new Error("layers.json 冇 wind_field");
          clearVerticalLayers(map, [def]);
          if (!on) break;
          const drawn = await applyVerticalLayers(map, [def], { registry, ctx, activeDistricts });
          if (!drawn.includes("wind_field")) throw new Error("風場圖層畫唔出");
          break;
        }
        case "weather_stations": {
          // A STATIC reference layer (CSDI snapshot), so it follows the same
          // config path as everything else rather than a bespoke branch.
          const def = registry.layers.find((l) => l.id === "weather_stations");
          if (!def) throw new Error("layers.json 冇 weather_stations");
          clearVerticalLayers(map, [def]);
          if (!on) break;
          const drawn = await applyVerticalLayers(map, [def], { registry, ctx, activeDistricts });
          if (!drawn.includes("weather_stations")) throw new Error("氣象站圖層畫唔出");
          break;
        }
        case "buildings3d": {
          await toggle3d(map, on);
          rail.setLayerError(id, null);
          break;
        }
        default:
          throw new Error(`unknown layer ${id}`);
      }
    } catch (err) {
      // A layer that cannot load says so on its own control — with the network
      // off this is the 3D error state, never a blank scene.
      const msg = err instanceof Error ? err.message : String(err);
      rail.setLayerError(id, msg);
      showBanner(lang() === "tc" ? `圖層開唔到：${id}` : `Layer failed: ${id}`, {
        label: lang() === "tc" ? "閂" : "Dismiss",
        run: hideBanner,
      });
      console.warn(`[hkcm] layer ${id} failed: ${msg}`);
    }
  }

  // --- online / offline -------------------------------------------------------
  const pulse = document.querySelector<HTMLElement>(".live-pulse")!;
  window.addEventListener("offline", () => {
    pulse.classList.add("off");
    engine.refreshAll(); // every panel that cannot answer goes to its error state
  });
  window.addEventListener("online", () => {
    pulse.classList.remove("off");
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

boot().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.append(
    h("div", { class: "panel is-error", style: "position:fixed;inset:auto 12px 12px auto;z-index:99" },
      h("div", { class: "p-error" }, `啟動失敗：${msg}`)),
  );
  console.error("[hkcm] boot failed", err);
});
