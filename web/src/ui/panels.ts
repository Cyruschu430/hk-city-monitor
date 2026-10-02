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
import { cadenceSeconds, degrade, errored, live, LOADING, quietSeconds, type Honesty } from "../lib/honesty.ts";
import { lang, onLangChange, t } from "../lib/i18n.ts";
import { renderPanel, type PanelData, type PanelDef, type WallImage } from "../lib/render.ts";
import { sourceLabel, type PanelDefRaw, type Registry } from "../lib/sources.ts";
import type { Camera } from "../map/cameras.ts";
import { pickWallCameras, wallImages } from "../map/cameras.ts";

/** Panels the engine is FED, never fetches. The set is empty since the
 *  analysis_brief panel (and the whole Tier 0-4 engine) was withdrawn (Cyrus
 *  2026-10-02). The mechanism is kept because it is how a fed panel stays out
 *  of the fetch/poll/coverage paths, and it may return. */
const FED_PANEL_IDS = new Set<string>([]);

interface Entry {
  panel: PanelDefRaw;
  data: PanelData | null;
  honesty: Honesty;
  timer: number | null;
  state?: unknown;
  /** Which region tab the reader picked on a wall that has them. null is 全部. Held on
   *  the ENTRY, not on the panel def: panels.json is a shared registry read by every
   *  consumer, and a per-reader choice must not be written back into it. */
  region?: string | null;
  /** True while this panel is waiting for its first scroll into view. Set by
   *  setPanels, cleared by the observer or by any explicit refresh, so a retry
   *  button can never leave a panel stuck in the deferred state. */
  deferred?: boolean;
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
  /** the set of user-hidden panels changed — the host repaints its restore chip */
  onHiddenChange?(ids: string[]): void;
}

export interface PanelEngine {
  setPanels(ids: string[]): void;
  /** Category tab filter (source `group`). null = 全部.
      Visibility ONLY: nothing is unmounted and nothing is re-fetched, so
      switching tabs costs zero requests and a panel keeps its last reading. */
  setGroupFilter(group: string | null): void;
  /** A panel the USER hid. Unlike the tab filter this also stops the poll loop:
      "I don't watch this" should not keep paying for a source, and the last
      reading is kept in memory so restoring shows it immediately. */
  setPanelHidden(id: string, hidden: boolean): void;
  hiddenIds(): string[];
  currentIds(): string[];
  refreshAll(): void;
  /** Live health tally over the panels currently MOUNTED. Feeds the coverage
      line in the status bar — the number has to come from what actually
      happened at runtime, never from a hardcoded total. */
  stats(): { total: number; live: number; stale: number; error: number; loading: number };
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

  let groupFilter: string | null = null;

  // User-hidden panels. A global preference, not per-mode: hiding the ferry
  // table because you never take the ferry must not undo itself the moment a
  // trigger switches the vertical.
  const HIDDEN_KEY = "hkcm.panelsHidden";
  const userHidden = new Set<string>(
    ((): string[] => {
      try {
        const raw = localStorage.getItem(HIDDEN_KEY);
        if (raw) return (JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === "string");
      } catch {
        /* private mode — start with nothing hidden */
      }
      return [];
    })(),
  );
  function writeHidden(): void {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...userHidden]));
    } catch {
      /* non-persistent is acceptable; the choice still holds for the session */
    }
  }

  // User ORDER. Global, like the hidden set and for the same reason: where a panel sits
  // is the reader's preference, not the vertical's. Stored as a flat list of ids, so a
  // stale entry for a panel that no longer exists is inert and a new panel simply has no
  // index yet (it keeps its configured position, after the ids the reader has placed).
  // BUMPED 2026-10-01 when ai_brief was added. MEASURED, and it took Cyrus telling me twice:
  // the panel was rendering - the DOM held 19 panels, one more than before - and he could not
  // see it, because a stored order that predates a panel has no position for it, so the engine
  // appended it to the END of the column, below the fold. check:layout could not catch this: it
  // runs in a fresh profile with no stored order. A version suffix is the whole migration.
  //
  // Bump this whenever a panel is ADDED to the set. Anyone who has dragged a panel keeps their
  // arrangement within a version; the arrangement itself is cheap to redo, and a new panel that
  // nobody can find is not.
  const ORDER_KEY = "hkcm.panelsOrder.v2";
  const userOrder: string[] = ((): string[] => {
    try {
      const raw = localStorage.getItem(ORDER_KEY);
      if (raw) return (JSON.parse(raw) as unknown[]).filter((x): x is string => typeof x === "string");
    } catch {
      /* private mode — the configured order stands */
    }
    return [];
  })();
  function applyOrder(ids: string[]): string[] {
    const rank = (id: string): number => {
      const i = userOrder.indexOf(id);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return ids.map((id, i) => [id, i] as const)
      .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
      .map(([id]) => id);
  }
  /** Read the column back out of the DOM after a drop and keep it. The DOM moves during
      the drag (that IS the feedback), so the drop only has to record what it already
      shows — remembering a drop position instead would be a second source of truth that
      a re-render could disagree with. */
  function writeOrder(): void {
    const next = [...root.querySelectorAll<HTMLElement>("[data-panel]")]
      .map((el) => el.dataset.panel)
      .filter((x): x is string => !!x);
    userOrder.length = 0;
    userOrder.push(...next);
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(next));
    } catch {
      /* session-only is acceptable; the column shows the new order either way */
    }
    order = applyOrder(order);
  }
  /** Drag a panel by its head. The head is the handle rather than the whole card, or a
      drag would start from any image text selection on the panel. */
  function makeDraggable(node: HTMLElement, head: Element | null, id: string): void {
    const handle = head as HTMLElement | null;
    if (!handle || handle.draggable) return;
    handle.draggable = true;
    handle.classList.add("p-grab");
    handle.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", id);
      node.classList.add("dragging");
    });
    handle.addEventListener("dragend", () => node.classList.remove("dragging"));
    node.addEventListener("dragover", (e) => {
      e.preventDefault(); // without this the browser never fires a drop
      const dragged = root.querySelector<HTMLElement>(".panel.dragging");
      if (!dragged || dragged === node) return;
      const box = node.getBoundingClientRect();
      node.parentElement?.insertBefore(dragged, e.clientY > box.top + box.height / 2 ? node.nextSibling : node);
    });
    node.addEventListener("drop", (e) => {
      e.preventDefault();
      node.classList.remove("dragging");
      writeOrder();
    });
  }
  /** A panel's category comes from its SOURCE, never from a field on the panel:
      one registry, so a tab cannot disagree with sources.json. */
  const groupOf = (entry: Entry): string => registry.byId.get(entry.panel.source)?.group ?? "";
  // A fed panel is a cross-cutting conclusion, not a member of a category, so a category tab
  // never hides it — hiding the answer when the reader narrows the question is the wrong way
  // round.
  const passes = (entry: Entry): boolean =>
    FED_PANEL_IDS.has(entry.panel.id) || groupFilter === null || groupOf(entry) === groupFilter;

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

  async function load(entry: Entry): Promise<{ data: PanelData; observedAt: Date | null; state?: unknown }> {
    // The picked region reaches the adapter as a panel param — the same channel as any
    // other per-panel parameter in panels.json, so the adapter keeps one signature and
    // the choice stays config-shaped. A copy, never a mutation of the shared registry.
    const panel: PanelDefRaw = entry.region
      ? { ...entry.panel, params: { ...entry.panel.params, region: entry.region } }
      : entry.panel;
    // Camera walls draw from the prebuilt camera lists — but ONLY the two
    // camera-wall sources. Any other image_wall panel (the live wall)
    // goes through its own adapter; the list-source shortcut must not capture
    // panels it was never meant for.
    if (panel.render === "image_wall" && (panel.source === "td_snapshot" || panel.source === "hko_webcam")) {
      const { data, observedAt } = wallData(panel);
      return { data, observedAt };
    }
    return adaptPanel(panel, ctx);
  }

  /** The × on the panel head. Built here rather than in render.ts so the
      renderer stays a pure function of the data and knows nothing about
      preferences. */
  function hideButton(id: string): HTMLElement {
    return h(
      "button",
      {
        class: "p-hide",
        type: "button",
        title: lang() === "tc" ? "隱藏此面板" : "Hide this panel",
        "aria-label": lang() === "tc" ? "隱藏此面板" : "Hide this panel",
        onclick: (e: Event) => {
          e.stopPropagation();
          api.setPanelHidden(id, true);
        },
      },
      "×",
    );
  }

  /** Stop every in-flight image inside a node before it is detached.
   *
   * MEASURED: switching modes repaints panels, which detaches `<img>` elements
   * that are still decoding. Chromium then logs
   * "InvalidStateError: The source image could not be decoded." — reproduced
   * deterministically by switching to 颱風模式 (0 errors on boot and after
   * refreshAll, 1 on the mode switch). The user sees nothing wrong (the new node
   * renders fine) but the console is not clean, and a dirty console is how real
   * errors get ignored.
   *
   * Assigning src to an EMPTY data URI cancels the pending fetch cleanly. It must
   * not be `img.src = ""` — that requests the page itself and produces the very
   * error we are removing (the same trap noted in lib/live.ts). */
  function cancelImageLoads(node: Element): void {
    for (const img of node.querySelectorAll("img")) {
      if (!img.complete) img.src = "data:,";
    }
  }

  function mount(id: string, node: HTMLElement): void {
    // A panel that mounts after a tab was picked must honour the filter, or a
    // slow source would pop into the wrong tab when its fetch lands.
    const pending = entries.get(id);
    if (pending && !passes(pending)) node.hidden = true;
    if (userHidden.has(id)) node.hidden = true;
    const head = node.querySelector(".panel-head");
    if (head && !head.querySelector(".p-hide")) head.append(hideButton(id));
    makeDraggable(node, head, id);
    const existing = root.querySelector(`[data-panel="${id}"]`);
    if (existing) {
      // Cancel BEFORE detaching, or the decode error fires on removal.
      cancelImageLoads(existing);
      existing.replaceWith(node);
    } else {
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
        sourceName: sourceLabel(src, entry.panel.source),
        sourceUrl: src?.url,
        emptyText: EMPTY_TEXT[entry.panel.source],
        onRetry: () => void refresh(id),
        onImageClick: deps.onWallImage,
        // The engine owns the picked region and re-runs the adapter, so the renderer
        // never holds selection state (see withRegionTabs in lib/render.ts).
        onRegionPick: (r) => {
          const e = entries.get(id);
          if (!e || (e.region ?? null) === r) return;
          e.region = r;
          void refresh(id);
        },
        // Row cap comes from panels.json `params.max` — config, not a
        // hardcoded opinion about which lists are too long.
        maxRows: typeof entry.panel.params?.["max"] === "number" ? (entry.panel.params["max"] as number) : undefined,
      }),
    );
    // Re-observed after EVERY paint, because mount() REPLACES the node: an
    // observation on the old node dies with it, and a panel the reader has already
    // scrolled to would then never load.
    if (entry.deferred) {
      const el = root.querySelector<HTMLElement>(`[data-panel="${id}"]`);
      if (el) observeForFetch(el);
    }
  }

  // --- Deferred fetch: only on-screen panels touch the network -----------------
  // MEASURED on World Monitor: 86 panels defined, 8 mounted, 78 deferred shells.
  // HKCM fetched every panel in `order` at once, so a 100-panel mode would fire 100
  // requests before the first one painted. `content-visibility` in app.css removes the
  // off-screen RENDER cost; this removes the off-screen FETCH cost, which is the half
  // that can actually run the free tier out of quota.
  // The guard lives in the two fetch-all paths (setPanels, refreshAll) rather than at
  // each caller, so no future caller can route around it by accident.
  let io: IntersectionObserver | null = null;
  function observeForFetch(el: HTMLElement): void {
    io ??= new IntersectionObserver(
      (hits) => {
        for (const hit of hits) {
          if (!hit.isIntersecting) continue;
          io?.unobserve(hit.target);
          const pid = (hit.target as HTMLElement).dataset["panel"];
          if (!pid) continue;
          const entry = entries.get(pid);
          if (!entry?.deferred) continue;
          entry.deferred = false;
          syncDeferredTag();
          void refresh(pid).then(() => {
            const e = entries.get(pid);
            if (e) schedule(e);
          });
        }
      },
      // root is #panels, the scroller itself. 400px of margin is roughly one panel
      // ahead of the fold: enough that a normal scroll never waits on a fetch, small
      // enough that the far end of a long column costs nothing.
      { root, rootMargin: "400px" },
    );
    io.observe(el);
  }

  // Derived on demand rather than kept as a running count: a counter that is
  // incremented in one path and decremented in another drifts the first time a path is
  // missed, and this number is what check-layout.mjs reads to prove the guard is live.
  function syncDeferredTag(): void {
    let n = 0;
    for (const e of entries.values()) if (e.deferred) n++;
    document.body.dataset["deferredPanels"] = String(n);
  }

  async function refresh(id: string): Promise<void> {
    const entry = entries.get(id);
    if (!entry) return;
    // An explicit refresh outranks the deferral: a retry button that left the panel
    // deferred would read as a button that does nothing.
    entry.deferred = false;
    // A first load shows the skeleton; a REFRESH keeps the last good data on
    // screen (with its timestamp) instead of blanking a working panel.
    if (entry.data === null) entry.honesty = LOADING;
    else entry.honesty = { ...entry.honesty, state: "live" };
    paint(id);
    try {
      const { data, observedAt, state } = await load(entry);
      if (!entries.has(id)) return; // panel was switched away mid-flight
      entry.data = data;
      // Degrade immediately, not on the next 30s tick: a payload whose own
      // timestamp is already old must mount as stale, never as live.
      const src = registry.byId.get(entry.panel.source);
      entry.honesty = degrade(live(observedAt ?? new Date()), quietSeconds(src?.cadence));
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
    // The reader's placement is applied HERE rather than at the drop, so a re-render
    // (every mode switch rebuilds the column) comes back in the order they chose.
    order = applyOrder(ids);
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
      // Registered but not fetched: a fed panel paints it, and `order` still contains it so
      // mount() places it correctly.
      if (FED_PANEL_IDS.has(id)) continue;
      // Deferred, not fetched. paint() mounts the skeleton and hands the node to the
      // observer; the fetch fires when the panel comes within 400px of the fold, so a
      // panel already above it loads on the next frame.
      entry.deferred = true;
      paint(id);
    }
    syncDeferredTag();
  }

  // Staleness is a function of time, not of requests: without this, a source
  // that stops answering leaves its last panel looking live forever.
  window.setInterval(() => {
    const now = new Date();
    for (const entry of entries.values()) {
      if (FED_PANEL_IDS.has(entry.panel.id)) continue; // fed panels have no cadence to be late
      const src = registry.byId.get(entry.panel.source);
      const next = degrade(entry.honesty, quietSeconds(src?.cadence), now);
      if (next.state !== entry.honesty.state) {
        entry.honesty = next;
        paint(entry.panel.id);
      }
    }
  }, 30_000);

  onLangChange(() => {
    for (const id of order) {
      const entry = entries.get(id);
      // Repaint from the ALREADY-FETCHED data — switching language must not
      // re-fetch. `paint()` reads `entry.data` and renders it, so the no-refetch
      // property lives there, not in a condition here. This used to read
      // `if (entry && entry.data) paint(id); else if (entry) paint(id);`, whose
      // two branches were identical: a guard that looked meaningful and was not,
      // which invites the next reader to "preserve" it.
      // A fed panel is not repainted from data it does not have — paint() would replace the
      // analysis node with a skeleton on every language switch.
      if (entry && !FED_PANEL_IDS.has(id)) paint(id);
    }
  });

  // `api` is named before the × in mount() can reach it: createPanelEngine
  // returns before any host calls setPanels, so the reference is always live by
  // the time a button exists to be clicked.
  const api: PanelEngine = {
    setPanels,
    setPanelHidden(id, hidden) {
      if (hidden) userHidden.add(id);
      else userHidden.delete(id);
      writeHidden();
      const entry = entries.get(id);
      const el = root.querySelector<HTMLElement>(`[data-panel="${id}"]`);
      if (el) el.hidden = hidden || (entry ? !passes(entry) : false);
      if (entry) {
        if (hidden) {
          if (entry.timer !== null) {
            window.clearTimeout(entry.timer);
            entry.timer = null;
          }
        } else if (entry.timer === null) {
          // Restore: show the cached reading at once, then refresh. Stopping the
          // poll is the reason hiding is worth doing, so un-hiding must restart it.
          paint(id);
          void refresh(id).then(() => {
            const e = entries.get(id);
            if (e) schedule(e);
          });
        }
      }
      deps.onHiddenChange?.([...userHidden]);
    },
    hiddenIds: () => [...userHidden],
    setGroupFilter(group) {
      groupFilter = group;
      for (const [id, entry] of entries) {
        const el = root.querySelector<HTMLElement>(`[data-panel="${id}"]`);
        if (el) el.hidden = !passes(entry);
      }
    },
    currentIds: () => [...order],
    refreshAll() {
      // Deliberately does NOT wake a deferred panel. refreshAll is the "settle
      // everything" call (mode switch, back online): a panel the reader has never
      // scrolled to has nothing on screen to settle, and its honest state is exactly
      // "not asked yet" — which is what it keeps. Scrolling to it fetches it then.
      for (const id of order) {
        const e = entries.get(id);
        if (e && !e.deferred) void refresh(id);
      }
    },
    stats() {
      // Deduplicated by SOURCE, not by panel: two panels reading the same
      // source are one upstream, and counting them twice would overstate the
      // coverage line in exactly the direction this project must not overstate.
      const bySource = new Map<string, Honesty["state"]>();
      for (const id of order) {
        const entry = entries.get(id);
        if (!entry) continue;
        // A fed panel has no source to be healthy or late, so counting it would report a
        // permanently missing panel in the coverage line.
        if (FED_PANEL_IDS.has(id)) continue;
        // The coverage line describes what is ON SCREEN, so a panel hidden by
        // the tab filter is not counted — otherwise hiding a broken panel would
        // silently improve the number.
        if (!passes(entry)) continue;
        if (userHidden.has(id)) continue;
        const prev = bySource.get(entry.panel.source);
        // Worst state wins, so one broken panel is never masked by a sibling.
        const rank = { error: 3, stale: 2, loading: 1, live: 0 } as const;
        if (!prev || rank[entry.honesty.state] > rank[prev]) bySource.set(entry.panel.source, entry.honesty.state);
      }
      const tally = { total: bySource.size, live: 0, stale: 0, error: 0, loading: 0 };
      for (const st of bySource.values()) tally[st] += 1;
      return tally;
    },
  };
  return api;
}

export { t as panelTitle };
