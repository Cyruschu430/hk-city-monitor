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
import { drawGlyphInto, type GlyphId } from "../map/symbols.ts";
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

/** Layer id → the runtime glyph that represents it. Config-first: a layer that
    declares `symbol` wins, otherwise fall back to the known ids.
    `wind-barb` is not a fixed glyph (there is one image per speed bucket), so
    it is excluded here and drawn as a generic swatch instead. */
function glyphFor(def: LayerDefRaw): GlyphId | null {
  if (def.symbol && def.symbol !== "wind-barb") return def.symbol as GlyphId;
  if (def.id === "cameras_all") return "cam-td";
  if (def.id === "hko_cameras") return "cam-hko";
  if (def.geom === "raster") return "water";
  return null;
}

export function createLayerControl(el: HTMLElement, onToggle: (row: LayerRow, on: boolean) => void): LayerControl {
  let rows: LayerRow[] = [];

  function build(): void {
    clear(el);
    el.hidden = false;

    const head = h(
      "div",
      { class: "lyr-head" },
      h("span", { class: "lyr-title" }, lang() === "tc" ? "圖層" : "LAYERS"),
      h("span", { class: "lyr-count" }, `${rows.length}`),
    );
    const body = h("div", { class: "lyr-body" });

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
    const label = items[i]?.querySelector<HTMLElement>(".lyr-label");
    if (!label) return;
    const text = row.label ?? row.def.title;
    label.textContent = lang() === "tc" ? text.tc : text.en;
  });
  const title = el.querySelector<HTMLElement>(".lyr-title");
  if (title) title.textContent = lang() === "tc" ? "圖層" : "LAYERS";
}
