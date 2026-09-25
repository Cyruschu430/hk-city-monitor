// layercontrol.ts — the LAYERS panel over the map face.
//
// Taken from a real World Monitor dashboard screenshot: its bottom-left has a
// checklist, one row per layer — checkbox, the layer's own little glyph, an
// upper-case name, an ⓘ (source / attribution) and an expand affordance. Tick
// shows the layer, untick hides it.
//
// Ours was a PASSIVE legend: it listed what happened to be drawn and could not
// be touched. Two problems with that. First, a user who does not want 1,047
// camera points has no way to say so. Second — and this is the honesty point —
// a legend that only ever describes what the code chose to draw is not an
// instrument; it is a caption.
//
// Toggling here changes VISIBILITY only. It never re-fetches and never mutates
// the mode's layer set: the mode still decides what is *available*, the user
// decides what is *shown*. That keeps the vertical contract (config decides
// layers) intact while giving the map a real control.

import { h, clear } from "../lib/dom.ts";
import { lang } from "../lib/i18n.ts";
import { drawGlyphInto, hasGlyph, type GlyphId } from "../map/symbols.ts";
import type { LayerDefRaw } from "../lib/sources.ts";

export interface LayerRow {
  def: LayerDefRaw;
  /** MapLibre layer ids this row owns, in draw order. */
  mapLayerIds: string[];
  /** Attribution shown behind the ⓘ. */
  sourceName: string;
  sourceUrl?: string;
  /** Where the row came from. A `vertical` row exists because the active mode
      asked for it; a `rail` row is a toggle the user controls directly. */
  kind?: "vertical" | "rail";
  /** For rail rows: the rail's own layer id, so the control mirrors the rail
      button's state rather than keeping a second copy of it. */
  railId?: string;
  /** Display label; falls back to def.title. The rail label is what the user
      just read on the button, so reusing it keeps the two in step. */
  label?: { tc: string; en: string };
}

export interface LayerControl {
  /** Replace the contents (called on every mode switch / layer apply). */
  setRows(rows: LayerRow[]): void;
  /** Hide the whole control (no drawable layers in this mode). */
  hide(): void;
  /** Mirror the rail's on/off state onto the rail-kind rows, so the button and
      the row can never disagree about what is switched on. */
  syncRail(on: string[]): void;
}

/** Layer id → the runtime glyph that represents it, for rows whose layers.json
 *  entry either has no `symbol` or belongs to a RAIL toggle that has no entry at
 *  all.
 *
 * The RAIL half is the important half. RAIL_LAYERS ids are `cameras_td`,
 * `cameras_hko`, `imagery`, `buildings3d` — none of which is a layers.json id (the
 * registry calls them `cameras_all` / `hko_cameras`). Those rows therefore used a
 * SYNTHETIC definition in `paintLegend()` with `geom: "raster"`, and the old
 * `geom === "raster" → water` fallback below then handed every one of them a water
 * droplet: 運輸署相機, 天文台相機, 航拍底圖 and 3D 樓宇 all wore the same blue drop as
 * the rain layer. MEASURED 2026-09-25 by reading the row symbols in the built
 * page. The fallback is gone; an unknown raster row now gets the gradient raster
 * swatch, which is honest about being "some raster", rather than the wrong icon. */
const GLYPH_BY_ID: Record<string, GlyphId> = {
  // rail toggles (synthetic defs — no layers.json entry)
  cameras_td: "cam-td",
  cameras_hko: "cam-hko",
  // layers.json ids
  cameras_all: "cam-td",
  hko_cameras: "cam-hko",
  control_points: "cp-land",
  water_suspension: "no-water",
  water_suspension_districts: "no-water",
  rain_nowcast: "water",
  buildings3d: "blocks",
  imagery: "aerial",
};

function glyphFor(def: LayerDefRaw): GlyphId | null {
  // Config-first: a layer that declares a REAL `symbol` wins. `hasGlyph` is the
  // guard that matters — `layers.json` is JSON, so `symbol: "poi"` type-checks as
  // nothing at all, and an unknown id makes `drawGlyphInto` return early and leave
  // a blank canvas. That is exactly what the control-point row was doing.
  if (def.symbol && hasGlyph(def.symbol)) return def.symbol;
  return GLYPH_BY_ID[def.id] ?? null;
}

/** Where the list's collapsed state lives. A persisted preference, so it is read
    once at module load and painted from ONE function that both `build()` and the
    click handler call — Pitfall 15: a preference written only from its change
    handler has no boot state, so a reload silently resets it and the user's
    choice was never really a choice. */
const COLLAPSE_KEY = "hkcm.lyrCollapsed";
const BODY_ID = "lyr-list";

let collapsed = ((): boolean => {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    /* private mode — start expanded, which is the safe default */
    return false;
  }
})();

/** The head's tooltip has to agree with its current state and language, so it
    is derived in one place rather than written at two call sites. */
function collapseTitle(isCollapsed: boolean): string {
  const tc = lang() === "tc";
  if (isCollapsed) return tc ? "展開圖層清單" : "Expand the layer list";
  return tc ? "收起圖層清單" : "Collapse the layer list";
}

export function createLayerControl(el: HTMLElement, onToggle: (row: LayerRow, on: boolean) => void): LayerControl {
  let rows: LayerRow[] = [];

  /** Repaint the collapsed state. Called by `build()` (so a rebuilt control
      keeps the user's choice) and by the head's click handler (so the two paths
      cannot drift). */
  function paintCollapsed(): void {
    el.classList.toggle("collapsed", collapsed);
    const head = el.querySelector<HTMLElement>(".lyr-head");
    if (!head) return;
    head.setAttribute("aria-expanded", collapsed ? "false" : "true");
    head.title = collapseTitle(collapsed);
  }

  function build(): void {
    clear(el);
    el.hidden = false;

    // The head is a BUTTON, not a label. It was a plain div, which made the
    // list a fixed object: on a small map face the rows covered the territory
    // and there was no way to put them away. `aria-expanded`/`aria-controls`
    // are set here rather than in CSS so the collapsed state is legible to a
    // screen reader and to QA without reading a class name.
    const head = h(
      "button",
      { class: "lyr-head", type: "button", "aria-expanded": "true", "aria-controls": BODY_ID },
      h(
        "span",
        { class: "lyr-head-t" },
        h("span", { class: "lyr-chev", "aria-hidden": "true" }),
        h("span", { class: "lyr-title" }, lang() === "tc" ? "圖層" : "LAYERS"),
      ),
      h("span", { class: "lyr-count" }, `${rows.length}`),
    );
    head.addEventListener("click", () => {
      collapsed = !collapsed;
      try {
        localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
      } catch {
        /* non-persistent is acceptable; the toggle still works this session */
      }
      paintCollapsed();
    });
    const body = h("div", { class: "lyr-body", id: BODY_ID });

    // A KEY, not a caption. Taken from World Monitor's bottom-centre legend bar,
    // which explains every dot colour on the map face.
    // MEASURED 2026-09-24: our camera clusters draw a bare number (101, 77, 56)
    // via `point_count_abbreviated` and NOTHING on screen said those are camera
    // counts. A first-time user sees unexplained integers floating over the
    // territory. Only shown when a camera row is actually present, so the key
    // never describes something that is not drawn.
    const hasClusters = rows.some((r) => r.mapLayerIds.some((id) => /cluster/.test(id)));
    if (hasClusters) {
      body.append(
        h(
          "div",
          { class: "lyr-key" },
          h("span", { class: "lyr-key-n" }, "101"),
          h(
            "span",
            { class: "lyr-key-t" },
            lang() === "tc" ? "圓圈數字＝該區鏡頭數目，撳一下會展開" : "Circle number = cameras in that area; click to expand",
          ),
        ),
      );
    }

    for (const row of rows) {
      const glyph = glyphFor(row.def);
      const label = row.label ?? row.def.title;

      const box = h("span", { class: "lyr-box", "aria-hidden": "true" });
      const btn = h(
        "button",
        {
          // `rail` marks a row the user drives from the rail too, so the two
          // controls can be kept in step and QA can tell them apart.
          class: `lyr-row${row.kind === "rail" ? " rail" : ""}`,
          type: "button",
          role: "switch",
          "aria-checked": "true",
          ...(row.railId ? { "data-rail": row.railId } : {}),
          title: lang() === "tc" ? "顯示／隱藏此圖層" : "Show / hide this layer",
        },
        box,
        glyph
          ? h("canvas", { class: `lyr-glyph g-${glyph}`, width: "14", height: "14" })
          : h("span", { class: `lyr-swatch sw-${row.def.geom}` }),
        h("span", { class: "lyr-label" }, lang() === "tc" ? label.tc : label.en),
      );
      btn.addEventListener("click", () => {
        const next = btn.getAttribute("aria-checked") !== "true";
        btn.setAttribute("aria-checked", next ? "true" : "false");
        btn.classList.toggle("off", !next);
        // A rail row delegates to the SAME callback the rail button uses, so
        // there is one toggle implementation rather than two that can drift.
        onToggle(row, next);
      });

      // ⓘ — attribution. The project rule is that every claim on screen is
      // traceable, and that applies to the map face too: a symbol with no
      // stated origin is decoration.
      const info = h(
        "button",
        {
          class: "lyr-info",
          type: "button",
          "aria-label": lang() === "tc" ? "來源" : "Source",
          title: row.sourceUrl ? `${row.sourceName} ↗` : row.sourceName,
        },
        "i",
      );
      info.addEventListener("click", (e) => {
        e.stopPropagation();
        const note = el.querySelector<HTMLElement>(`[data-note-for="${row.def.id}"]`);
        if (!note) return;
        note.hidden = !note.hidden;
      });

      const wrap = h("div", { class: "lyr-item" }, h("div", { class: "lyr-line" }, btn, info));
      const note = h(
        "div",
        { class: "lyr-note", hidden: "true", "data-note-for": row.def.id },
        row.sourceUrl
          ? h("a", { href: row.sourceUrl, target: "_blank", rel: "noopener" }, `${row.sourceName} ↗`)
          : row.sourceName,
      );
      wrap.append(note);
      body.append(wrap);
    }

    el.append(head, body);
    paintCollapsed();

    // The glyphs are drawn from the same primitives the map uses, so a legend
    // row can never drift from the symbol actually drawn on the map.
    for (const cv of el.querySelectorAll("canvas")) {
      const cls = cv.className;
      const m = /g-([a-z-]+)/.exec(cls);
      if (m?.[1]) drawGlyphInto(cv as HTMLCanvasElement, m[1] as GlyphId, 14);
    }
  }

  return {
    setRows(next: LayerRow[]) {
      rows = next;
      // No longer hides on an empty set: the control now always carries the
      // rail's toggles, so it has content in every mode. Hiding it was what made
      // it look absent entirely in overview (measured: hidden=true, rows=0).
      build();
    },
    hide() {
      el.hidden = true;
    },
    syncRail(on: string[]) {
      const set = new Set(on);
      for (const btn of el.querySelectorAll<HTMLElement>(".lyr-row[data-rail]")) {
        const id = btn.dataset["rail"] ?? "";
        const isOn = set.has(id);
        btn.setAttribute("aria-checked", isOn ? "true" : "false");
        btn.classList.toggle("off", !isOn);
      }
    },
  };
}

/** Re-label without losing toggle state (language switch). */
export function relabelLayerControl(el: HTMLElement, rows: LayerRow[]): void {
  const items = el.querySelectorAll<HTMLElement>(".lyr-item");
  rows.forEach((row, i) => {
    const item = items[i];
    const label = item?.querySelector<HTMLElement>(".lyr-label");
    if (label) {
      const text = row.label ?? row.def.title;
      label.textContent = lang() === "tc" ? text.tc : text.en;
    }
    // THE SOURCE NOTE NEEDS RELABELLING TOO. MEASURED 2026-09-25: this function
    // only touched `.lyr-label`, so after a language switch the layer names
    // became English while the ⓘ note beside every one of them stayed Chinese —
    // the exact half-translated state the EN audit exists to catch.
    const note = item?.querySelector<HTMLElement>(".lyr-note");
    if (note) {
      const a = note.querySelector("a");
      const text = row.sourceName;
      if (a) a.textContent = `${text} ↗`;
      else note.textContent = text;
    }
    const info = item?.querySelector<HTMLElement>(".lyr-info");
    if (info) {
      info.setAttribute("aria-label", lang() === "tc" ? "來源" : "Source");
      info.title = row.sourceUrl ? `${row.sourceName} ↗` : row.sourceName;
    }
  });
  const title = el.querySelector<HTMLElement>(".lyr-title");
  if (title) title.textContent = lang() === "tc" ? "圖層" : "LAYERS";
  // The head's tooltip is user-facing copy too, so it is re-derived on a
  // language switch from the SAME function `build()` uses. Left out, the tooltip
  // would be the one string on the map face that stayed in the old language.
  const head = el.querySelector<HTMLElement>(".lyr-head");
  if (head) head.title = collapseTitle(el.classList.contains("collapsed"));
}
