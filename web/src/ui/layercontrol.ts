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
}

export interface LayerControl {
  /** Replace the contents (called on every mode switch / layer apply). */
  setRows(rows: LayerRow[]): void;
  /** Hide the whole control (no drawable layers in this mode). */
  hide(): void;
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

    for (const row of rows) {
      const glyph = glyphFor(row.def);
      const on = { value: true };

      const box = h("span", { class: "lyr-box", "aria-hidden": "true" });
      const btn = h(
        "button",
        {
          class: "lyr-row",
          type: "button",
          role: "switch",
          "aria-checked": "true",
          title: lang() === "tc" ? "顯示／隱藏此圖層" : "Show / hide this layer",
        },
        box,
        glyph
          ? h("canvas", { class: `lyr-glyph g-${glyph}`, width: "14", height: "14" })
          : h("span", { class: `lyr-swatch sw-${row.def.geom}` }),
        h("span", { class: "lyr-label" }, lang() === "tc" ? row.def.title.tc : row.def.title.en),
      );
      btn.addEventListener("click", () => {
        on.value = !on.value;
        btn.setAttribute("aria-checked", on.value ? "true" : "false");
        btn.classList.toggle("off", !on.value);
        onToggle(row, on.value);
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
      if (next.length === 0) {
        el.hidden = true;
        return;
      }
      build();
    },
    hide() {
      el.hidden = true;
    },
  };
}

/** Re-label without losing toggle state (language switch). */
export function relabelLayerControl(el: HTMLElement, rows: LayerRow[]): void {
  const items = el.querySelectorAll<HTMLElement>(".lyr-item");
  rows.forEach((row, i) => {
    const label = items[i]?.querySelector<HTMLElement>(".lyr-label");
    if (label) label.textContent = lang() === "tc" ? row.def.title.tc : row.def.title.en;
  });
  const title = el.querySelector<HTMLElement>(".lyr-title");
  if (title) title.textContent = lang() === "tc" ? "圖層" : "LAYERS";
}
