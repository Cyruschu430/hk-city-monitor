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
import { lang, t } from "./lib/i18n.ts";
import { loadRegistry, type VerticalDefRaw } from "./lib/sources.ts";
import { createMap, landsdBadge, setBasemap } from "./map/basemap.ts";
import { addCameraLayers, loadCameras, TD_SRC, HKO_SRC, type Camera } from "./map/cameras.ts";
import { applyVerticalLayers, clearVerticalLayers } from "./map/overlays.ts";
import { toggle3d } from "./map/overlays3d.ts";
import type { LayerDefRaw } from "./lib/sources.ts";
import { createDrawer } from "./ui/drawer.ts";
import { createPanelEngine } from "./ui/panels.ts";
import { createRail, type RailLayer } from "./ui/rail.ts";
import { createStatusBar } from "./ui/statusbar.ts";

/** The vertical-free default view. Six panels covering the six render types a
    resident needs before choosing a mode. */
const OVERVIEW = ["warnings_list", "cameras_wall", "special_traffic_list", "tp_queue_grid", "ae_waiting_grid", "water_suspension_list"];

/** Trigger polling: two sources, 3 minutes. The Worker edge-caches 60s, so a
    faster loop would buy nothing. */
const TRIGGER_POLL_MS = 3 * 60_000;

const RAIL_LAYERS: RailLayer[] = [
  { id: "cameras_td", label: { tc: "運輸署相機", en: "TD cameras" }, on: true },
  { id: "cameras_hko", label: { tc: "天文台相機", en: "HKO cameras" }, on: true },
  { id: "rain_nowcast", label: { tc: "降雨臨近預報", en: "Rain nowcast" } },
  { id: "imagery", label: { tc: "航拍底圖", en: "Aerial basemap" } },
  { id: "buildings3d", label: { tc: "3D 樓宇（載入慢）", en: "3D buildings (heavy)" } },
];

async function boot(): Promise<void> {
  const statusbar = createStatusBar(document.getElementById("statusbar")!);
  const railEl = document.getElementById("rail")!;
  const panelsEl = document.getElementById("panels")!;
  const mapEl = document.getElementById("map")!;
  const hudEl = document.getElementById("mapHud")!;
  const drawerEl = document.getElementById("drawer")!;

  const [registry, cameras, manifest] = await Promise.all([
    loadRegistry(),
    loadCameras(),
    fetch("data/build-manifest.json").then((r) => r.json() as Promise<{ tilesVia: string }>).catch(() => ({ tilesVia: "direct" })),
  ]);

  statusbar.setTiles(manifest.tilesVia);
  statusbar.setCameras(cameras.td.length, cameras.hko.length);

  const map = createMap(mapEl);
  // QA hook — the element id `map` shadows a global `map`, so the instance is
  // exposed explicitly (measured pitfall, AGENTS.md).
  (window as unknown as Record<string, unknown>)["__map"] = map;

  const drawer = createDrawer(drawerEl);
  addCameraLayers(map, cameras, { onSelect: (cam: Camera) => drawer.openCamera(cam) });
  hudEl.append(landsdBadge());

  const banner = h("div", { class: "panel", style: "position:absolute;left:12px;top:12px;max-width:420px;display:none" });
  hudEl.append(banner);

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

  const emit = (sourceId: string, value: unknown) => {
    triggerState[sourceId] = value;
    if (sourceId === "wsd_water_suspension") {
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
  };

  const engine = createPanelEngine({
    root: panelsEl,
    registry,
    ctx,
    cameras,
    tilesVia: manifest.tilesVia,
    onWallImage: (img) => {
      const cam = [...cameras.td, ...cameras.hko].find((c) => c.id === img.id);
      if (cam) drawer.openCamera(cam);
    },
    onState: emit,
  });

  // verticals.json is validated to the closed trigger syntax by
  // scripts/validate_config.py; the cast is the JSON→type boundary.
  const verticals = registry.verticals as unknown as VerticalDef[];
  const rail = createRail(railEl, registry.verticals, RAIL_LAYERS, {
    onMode: (id) => activateMode(id, true),
    onToggleLayer: (id, on) => void toggleLayer(id, on),
  });

  function showBanner(title: string, action: { label: string; run: () => void } | null): void {
    clear(banner);
    banner.style.display = "";
    banner.append(
      h(
        "div",
        { class: "panel-head", style: "margin-bottom:6px" },
        h("h2", {}, title),
        action ? h("button", { class: "chip stale", type: "button", onclick: action.run }, action.label) : h("span", {}),
      ),
    );
  }

  function hideBanner(): void {
    banner.style.display = "none";
    clear(banner);
  }

  /** Draw exactly the layers a vertical names — from layers.json, nothing else. */
  async function applyModeLayers(layerIds: string[]): Promise<void> {
    currentLayerIds = layerIds;
    clearVerticalLayers(map, drawnLayers);
    drawnLayers = [];
    const defs = layerIds
      .map((lid) => registry.layers.find((l) => l.id === lid))
      .filter((l): l is LayerDefRaw => !!l);
    try {
      const drawn = await applyVerticalLayers(map, defs, { registry, ctx, activeDistricts });
      drawnLayers = defs.filter((d) => drawn.includes(d.id));
    } catch (err) {
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
    if (manual) userPinned = true;
    rail.setActive(id);
    const v = registry.verticals.find((x) => x.id === id);
    statusbar.setMode(
      v ? `${lang() === "tc" ? v.name.tc : v.name.en}` : lang() === "tc" ? "總覽" : "Overview",
      v ? (lang() === "tc" ? v.question.tc : v.question.en) : "",
    );
    engine.setPanels(v ? v.order : OVERVIEW);
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
    showBanner(lang() === "tc" ? `偵測到：${v.name.tc}（${v.question.tc}）` : `Detected: ${v.name.en}`, {
      label: lang() === "tc" ? "切換" : "Switch",
      run: () => activateMode(v.id, true),
    });
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
            map.setLayoutProperty(`${TD_SRC}-${suffix}`, "visibility", on ? "visible" : "none");
          }
          break;
        case "cameras_hko":
          for (const suffix of ["cluster", "count", "point"]) {
            map.setLayoutProperty(`${HKO_SRC}-${suffix}`, "visibility", on ? "visible" : "none");
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
  drawer.close();
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
