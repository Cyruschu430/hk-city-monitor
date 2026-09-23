// rail.ts — the 56px left rail: mode switcher (總覽 + every vertical from
// verticals.json) on top, map-layer toggles below. Icons are inline SVG with
// 1.5px stroke (DESIGN_BRIEF §7 — never an emoji, never an icon font).
//
// Verticals are DATA: this file renders whatever verticals.json contains and
// knows nothing about typhoons or water. That is what makes Run 5 a config run.

import { h, icon } from "../lib/dom.ts";
import { lang, onLangChange } from "../lib/i18n.ts";
import type { VerticalDefRaw } from "../lib/sources.ts";

export interface RailCallbacks {
  onMode(id: string): void;
  onToggleLayer(id: string, on: boolean): void;
}

const ICONS: Record<string, string> = {
  overview: "M4 12h16M12 4v16|M12 3a9 9 0 100 18 9 9 0 000-18z",
  typhoon: "M12 12c0-4 3-7 7-7-1 4-3 7-7 7zM12 12c0 4-3 7-7 7 1-4 3-7 7-7z",
  border: "M4 8h16M4 16h16M9 4v16M15 4v16",
  water: "M12 3c3 4 6 6.5 6 10a6 6 0 11-12 0c0-3.5 3-6 6-10z",
  leave: "M7 3v4M17 3v4M4 8h16M5 5h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z",
};

/** Per-mode accent — keyed by the VERTICAL ID (verticals.json), so a mode is
    identifiable by colour before its glyph (颱風=紅, 口岸=青, 停水=藍, 假期=綠,
    總覽=中性). Applied on the active state only; idle stays muted so a wall
    of colour never competes with the map. */
const ACCENTS: Record<string, string> = {
  overview: "#8ea6c4",
  typhoon: "#ff5d6c",
  border: "#22d3ee",
  water_supply: "#38bdf8",
  leave: "#34d399",
};

const LAYER_ICONS: Record<string, string> = {
  cameras_td: "M3 7h11v10H3zM14 10l7-3v10l-7-3|M7 12h3",
  cameras_hko: "M12 4v2M5 20h14M8 20a4 4 0 018 0M12 8a4 4 0 014 4v4H8v-4a4 4 0 014-4z",
  rain_nowcast: "M7 15a4 4 0 010-8 5 5 0 019.6 1.4A3.5 3.5 0 0116 15H7zM9 19l-1 2M13 19l-1 2M17 19l-1 2",
  imagery: "M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6",
  buildings3d: "M4 20V9l8-5 8 5v11M9 20v-6h6v6",
  aircraft: "M12 2l2 7 7 3v2l-7-1v5l2.5 2v1.6L12 20.5l-4.5 1.1V20l2.5-2v-5l-7 1v-2l7-3z",
  wind_field: "M3 8h11a3 3 0 10-3-3|M3 12h15a3 3 0 11-3 3|M3 16h9",
  weather_stations: "M12 4v16|M7 9h10|M9 4h6|M5 20h14",
};

export interface RailLayer {
  id: string;
  label: { tc: string; en: string };
  on?: boolean;
}

export interface RailHandle {
  setActive(id: string): void;
  setLayerError(id: string, message: string | null): void;
  /** the rail's button for a layer id — lets the LAYERS control drive the same
      toggle path rather than reimplementing it */
  layerButton(id: string): HTMLElement | null;
  /** which layer toggles are currently on, read from the buttons */
  layersOn(): string[];
}

export function createRail(
  root: HTMLElement,
  verticals: VerticalDefRaw[],
  layers: RailLayer[],
  cb: RailCallbacks,
): RailHandle {
  const modeButtons = new Map<string, HTMLElement>();
  const layerButtons = new Map<string, HTMLElement>();

  const build = () => {
    root.replaceChildren();
    modeButtons.clear();
    layerButtons.clear();

    const addMode = (id: string, name: { tc: string; en: string }, title: string) => {
      const b = h(
        "button",
        {
          class: "rail-btn",
          type: "button",
          "aria-pressed": "false",
          "data-accent": ACCENTS[id] ?? "",
          onclick: () => cb.onMode(id),
        },
        icon(ICONS[id] ?? ICONS["overview"]!),
        h("span", { class: "tip" }, `${lang() === "tc" ? name.tc : name.en} · ${title}`),
      );
      modeButtons.set(id, b);
      root.append(b);
    };

    addMode("overview", { tc: "總覽", en: "Overview" }, lang() === "tc" ? "全部重要面板" : "all key panels");
    for (const v of verticals) addMode(v.id, v.name, lang() === "tc" ? v.question.tc : v.question.en);

    root.append(h("div", { class: "rail-sep" }));

    for (const l of layers) {
      const b = h(
        "button",
        {
          class: "rail-btn",
          type: "button",
          "aria-pressed": String(!!l.on),
          onclick: () => {
            const next = b.getAttribute("aria-pressed") !== "true";
            b.setAttribute("aria-pressed", String(next));
            cb.onToggleLayer(l.id, next);
          },
        },
        icon(LAYER_ICONS[l.id] ?? ICONS["overview"]!),
        h("span", { class: "tip" }, lang() === "tc" ? l.label.tc : l.label.en),
      );
      layerButtons.set(l.id, b);
      root.append(b);
    }
  };

  build();
  onLangChange(build);

  return {
    setActive(id) {
      for (const [key, b] of modeButtons) {
        b.setAttribute("aria-pressed", String(key === id));
        // Active colour follows the mode's accent; idle buttons stay muted.
        b.style.color = key === id ? (ACCENTS[key] ?? "") : "";
      }
    },
    setLayerError(id, message) {
      const b = layerButtons.get(id);
      if (!b) return;
      if (message) {
        b.setAttribute("aria-pressed", "false");
        b.setAttribute("title", message);
        b.style.color = "var(--alert)";
      } else {
        b.style.color = "";
      }
    },
    /** The rail's own button for a layer, so the LAYERS control can drive the
     *  identical toggle path instead of duplicating what "on" means. */
    layerButton(id) {
      return layerButtons.get(id) ?? null;
    },
    /** Which layer toggles are currently ON, read from the buttons themselves.
     *  The rail button IS the state — `aria-pressed` is set by the same click
     *  handler that flips it, so reading it here cannot go stale. */
    layersOn() {
      const out: string[] = [];
      for (const [id, b] of layerButtons) if (b.getAttribute("aria-pressed") === "true") out.push(id);
      return out;
    },
  };
}
