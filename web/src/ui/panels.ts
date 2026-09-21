// panels.ts — the panel engine. Given a list of panel ids (which comes from
// verticals.json, or from the overview set), it fetches each source on its own
// cadence, renders through the ONE renderer, and manages the four honesty
// states over time. No per-panel UI code lives anywhere else.
//
// Honesty is enforced here, not by the renderer:
//   - a failed fetch → error state naming the source and the failure
//   - data past 2× its cadence → stale (amber), recomputed every 30s so a
//     panel cannot sit there looking live after its source went quiet
//   - a live fetch with zero records → the panel says so plainly

import { MIN_REFRESH_MS } from "../config.ts";
import { adaptPanel, type AdapterCtx } from "../lib/adapters.ts";
import { clear, h } from "../lib/dom.ts";
import { cadenceSeconds, degrade, errored, live, LOADING, type Honesty } from "../lib/honesty.ts";
import { lang, onLangChange, t } from "../lib/i18n.ts";
import { renderPanel, type PanelData, type PanelDef, type WallImage } from "../lib/render.ts";
import type { PanelDefRaw, Registry } from "../lib/sources.ts";
import type { Camera } from "../map/cameras.ts";
import { pickWallCameras, wallImages } from "../map/cameras.ts";

interface Entry {
  panel: PanelDefRaw;
  data: PanelData | null;
  honesty: Honesty;
  timer: number | null;
  state?: unknown;
}

export interface PanelEngineDeps {
  root: HTMLElement;
  registry: Registry;
  ctx: AdapterCtx;
  cameras: { td: Camera[]; hko: Camera[] };
  tilesVia: string;
  onWallImage?(img: WallImage): void;
  /** trigger-engine state contributions, keyed by source id */
  onState?(sourceId: string, value: unknown): void;
}

export interface PanelEngine {
  setPanels(ids: string[]): void;
  currentIds(): string[];
  refreshAll(): void;
}

const EMPTY_TEXT: Record<string, { tc: string; en: string }> = {
  hko_warnsum: { tc: "現時無生效天氣警告", en: "No weather warnings in force" },
  wsd_water_suspension: { tc: "現時無臨時停水通知", en: "No temporary water suspension notices" },
  td_specialtrafficnews: { tc: "現時無特別交通消息", en: "No special traffic news" },
  hko_tc_track: { tc: "現時無熱帶氣旋", en: "No active tropical cyclone" },
  hkia_flights: { tc: "現時無航班資料", en: "No flight data" },
  mardep_crossboundary_ferry: { tc: "現時無跨境渡輪班次", en: "No cross-boundary ferry services" },
};

export function createPanelEngine(deps: PanelEngineDeps): PanelEngine {
  const { root, registry, ctx, cameras } = deps;
  const entries = new Map<string, Entry>();
  let order: string[] = [];

  const defOf = (id: string): PanelDefRaw | undefined => registry.panels.find((p) => p.id === id);

  function wallData(panel: PanelDefRaw): { data: PanelData; observedAt: Date } {
    const isHko = panel.source === "hko_webcam";
    const list = isHko ? cameras.hko : cameras.td;
    const n = isHko ? 8 : 8;
    const useProxy = isHko; // HKO images are CORS-closed; TD is hotlinkable
    const fresh = isHko ? (lang() === "tc" ? "5分鐘" : "5 min") : lang() === "tc" ? "2分鐘" : "2 min";
    return {
      data: { kind: "image_wall", images: wallImages(pickWallCameras(list, n), useProxy, fresh) },
      observedAt: new Date(),
    };
  }

  async function load(panel: PanelDefRaw): Promise<{ data: PanelData; observedAt: Date | null; state?: unknown }> {
    // Image walls draw from the prebuilt camera lists, not from a single image
    // source — `params.list_source` in the panel definition is what says so.
    if (panel.render === "image_wall") {
      const { data, observedAt } = wallData(panel);
      return { data, observedAt };
    }
    return adaptPanel(panel, ctx);
  }

  function mount(id: string, node: HTMLElement): void {
    const existing = root.querySelector(`[data-panel="${id}"]`);
    if (existing) existing.replaceWith(node);
    else {
      // Keep the configured order even when one panel resolves later.
      const idx = order.indexOf(id);
      const after = order
        .slice(0, idx)
        .map((pid) => root.querySelector(`[data-panel="${pid}"]`))
        .filter((el): el is Element => el !== null)
        .pop();
      if (after) after.after(node);
      else root.prepend(node);
    }
  }

  function paint(id: string): void {
    const entry = entries.get(id);
    if (!entry) return;
    const src = registry.byId.get(entry.panel.source);
    // panels.json is validated by scripts/validate_config.py; the cast is the
    // boundary between "a string from JSON" and the closed render union.
    const def = entry.panel as unknown as PanelDef;
    mount(
      id,
      renderPanel(def, entry.data, entry.honesty, {
        sourceName: src?.name,
        sourceUrl: src?.url,
        emptyText: EMPTY_TEXT[entry.panel.source],
        onRetry: () => void refresh(id),
        onImageClick: deps.onWallImage,
      }),
    );
  }

  async function refresh(id: string): Promise<void> {
    const entry = entries.get(id);
    if (!entry) return;
    // A first load shows the skeleton; a REFRESH keeps the last good data on
    // screen (with its timestamp) instead of blanking a working panel.
    if (entry.data === null) entry.honesty = LOADING;
    else entry.honesty = { ...entry.honesty, state: "live" };
    paint(id);
    try {
      const { data, observedAt, state } = await load(entry.panel);
      if (!entries.has(id)) return; // panel was switched away mid-flight
      entry.data = data;
      // Degrade immediately, not on the next 30s tick: a payload whose own
      // timestamp is already old must mount as stale, never as live.
      const src = registry.byId.get(entry.panel.source);
      entry.honesty = degrade(live(observedAt ?? new Date()), cadenceSeconds(src?.cadence));
      if (state !== undefined) deps.onState?.(entry.panel.source, state);
    } catch (err) {
      if (!entries.has(id)) return;
      // Keep the last known data in memory but show the error state: a stale
      // number presented as current is the thing this project must not do.
      entry.honesty = errored(err instanceof Error ? err.message : String(err), entry.honesty.updatedAt);
    }
    paint(id);
  }

  function schedule(entry: Entry): void {
    if (entry.timer !== null) window.clearTimeout(entry.timer);
    const src = registry.byId.get(entry.panel.source);
    const cadenceMs = Math.max(MIN_REFRESH_MS, cadenceSeconds(src?.cadence) * 1000);
    entry.timer = window.setTimeout(() => {
      void refresh(entry.panel.id);
      schedule(entry);
    }, cadenceMs);
  }

  function setPanels(ids: string[]): void {
    order = ids;
    clear(root);
    for (const entry of entries.values()) {
      if (entry.timer !== null) window.clearTimeout(entry.timer);
    }
    entries.clear();
    for (const id of ids) {
      const panel = defOf(id);
      if (!panel) {
        root.append(h("section", { class: "panel is-error" }, h("div", { class: "p-error" }, `panel ${id} 唔在 panels.json`)));
        continue;
      }
      const entry: Entry = { panel, data: null, honesty: LOADING, timer: null };
      entries.set(id, entry);
      paint(id);
      void refresh(id).then(() => {
        const e = entries.get(id);
        if (e) schedule(e);
      });
    }
  }

  // Staleness is a function of time, not of requests: without this, a source
  // that stops answering leaves its last panel looking live forever.
  window.setInterval(() => {
    const now = new Date();
    for (const entry of entries.values()) {
      const src = registry.byId.get(entry.panel.source);
      const next = degrade(entry.honesty, cadenceSeconds(src?.cadence), now);
      if (next.state !== entry.honesty.state) {
        entry.honesty = next;
        paint(entry.panel.id);
      }
    }
  }, 30_000);

  onLangChange(() => {
    for (const id of order) {
      const entry = entries.get(id);
      // Re-render from cache — switching language must not re-fetch.
      if (entry && entry.data) paint(id);
      else if (entry) paint(id);
    }
  });

  return {
    setPanels,
    currentIds: () => [...order],
    refreshAll() {
      for (const id of order) void refresh(id);
    },
  };
}

export { t as panelTitle };
