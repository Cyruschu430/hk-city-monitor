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

// Icons are keyed by VERTICAL ID. `leave` was removed 2026-09-24 with the
// 請假攻略 mode (Cyrus); its calendar icon and green accent went with it. Both
// maps degrade gracefully for an unknown id (a generic glyph, the default
// accent), so removing an entry here is safe — but leaving a dead one invites
// the next reader to think the mode still exists.
const ICONS: Record<string, string> = {
  overview: "M4 12h16M12 4v16|M12 3a9 9 0 100 18 9 9 0 000-18z",
  typhoon: "M12 12c0-4 3-7 7-7-1 4-3 7-7 7zM12 12c0 4-3 7-7 7 1-4 3-7 7-7z",
  border: "M4 8h16M4 16h16M9 4v16M15 4v16",
  // Was keyed `water` while the vertical id is `water_supply`, so 停水模式 silently
  // fell back to the generic 總覽 glyph. The maps degrade gracefully — which is why
  // a dead key looks like nothing is wrong.
  water_supply: "M12 3c3 4 6 6.5 6 10a6 6 0 11-12 0c0-3.5 3-6 6-10z",
  weather: "M16 13h1a3 3 0 100-6 5 5 0 00-9.6 1.4A3.5 3.5 0 008 15h8z|M5 4l1.5 1.5|M3 9h2",
  traffic: "M9 3h6v18H9z|M12 7h.01|M12 12h.01|M12 17h.01",
  drone: "M12 10a2 2 0 100 4 2 2 0 000-4|M10.6 10.6L5.5 5.5|M13.4 10.6l5.1-5.1|M10.6 13.4l-5.1 5.1|M13.4 13.4l5.1 5.1|M4 4h3M17 4h3M4 4v3M20 4v3",
  freight: "M3 7.5L12 2.5l9 5v9l-9 5-9-5z|M3 7.5l9 5 9-5|M12 12.5v9",
  health: "M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z",
  civic: "M4 21V9l6-4v16|M10 21V12l6-3v12|M3 21h18",
  live: "M12 10a2 2 0 100 4 2 2 0 000-4|M8.5 8.5a5 5 0 000 7|M15.5 8.5a5 5 0 010 7|M6 6a8.5 8.5 0 000 12|M18 6a8.5 8.5 0 010 12",
};

/** Per-mode accent — keyed by the VERTICAL ID (verticals.json), so a mode is
    identifiable by colour before its glyph (颱風=紅, 口岸=青, 停水=藍,
    總覽=中性). Applied on the active state only; idle stays muted so a wall
    of colour never competes with the map. */
const ACCENTS: Record<string, string> = {
  overview: "#8ea6c4",
  typhoon: "#ff5d6c",
  border: "#22d3ee",
  water_supply: "#38bdf8",
  // Ten modes need ten hues that stay apart at 56px on a dark map face. Hue does the
  // separating (indigo / amber / purple / orange / pink / emerald), not brightness —
  // a palette that only varies lightness reads as one colour when it is this small.
  weather: "#818cf8",
  traffic: "#fbbf24",
  drone: "#c084fc",
  freight: "#fb923c",
  health: "#f472b6",
  civic: "#34d399",
  live: "#ef4444",
};

const LAYER_ICONS: Record<string, string> = {
  cameras_td: "M3 7h11v10H3zM14 10l7-3v10l-7-3|M7 12h3",
  cameras_hko: "M12 4v2M5 20h14M8 20a4 4 0 018 0M12 8a4 4 0 014 4v4H8v-4a4 4 0 014-4z",
  rain_nowcast: "M7 15a4 4 0 010-8 5 5 0 019.6 1.4A3.5 3.5 0 0116 15H7zM9 19l-1 2M13 19l-1 2M17 19l-1 2",
  imagery: "M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6",
  aircraft: "M12 2l2 7 7 3v2l-7-1v5l2.5 2v1.6L12 20.5l-4.5 1.1V20l2.5-2v-5l-7 1v-2l7-3z",
  wind_field: "M3 8h11a3 3 0 10-3-3|M3 12h15a3 3 0 11-3 3|M3 16h9",
  weather_stations: "M12 4v16|M7 9h10|M9 4h6|M5 20h14",
  // A hexagon with a slash: a zone, and a prohibition. The camera and station glyphs are objects;
  // this one has to read as an AREA, because that is the difference between this layer and every
  // other marker layer on the rail.
  drone_rfz: "M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9zM7.5 7.5l9 9",
  // A heart with a bolt: the universal defibrillator mark, and the only rail icon that is about
  // the person looking at the screen rather than about the city.
  aed_locations: "M12 20s-7-4.4-7-9.2A4 4 0 0112 8a4 4 0 017 2.8C19 15.6 12 20 12 20z|M12.8 10l-2 3h2l-1 3 3-3.6h-2z",
  // A ship over a berth line: the cargo working areas are waterfront, and the glyph has to
  // differ from the aircraft this layer also carries.
  hk_facility_areas: "M3 18h18|M5 14l1.5 3h11L19 14|M12 4l6 3v5H6V7z",
  // A tank: the oil storage installations are vertical cylinders, not boxes.
  hk_facility_pins: "M7 9h10v9a2 2 0 01-2 2H9a2 2 0 01-2-2z|M7 9a5 3 0 0110 0|M12 3v3",
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
          // `data-accent` was DEAD CONFIG until 2026-09-25: rail.ts set it and no
          // CSS rule read it, so every mode's "accent colour" was the one global
          // `--cyan` and the per-mode palette in ACCENTS existed only in this file.
          // (The gate's accent check hid it — it read the first pressed rail button,
          // which was a CAMERA button that is cyan anyway, so it passed while
          // measuring a different element entirely.) Publishing it as a custom
          // property makes the existing 5-colour palette real: modes now read apart
          // at a glance, which is the point of an accent.
          style: ACCENTS[id] ? `--accent:${ACCENTS[id]}` : "",
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
          // The LAYER ROWS already carry `data-rail` (layercontrol.syncRail addresses them by it);
          // the rail's own buttons carried nothing, so no check and no QA script could reach the
          // button a user actually clicks. One attribute, and the two entry points for a layer
          // become addressable by the same id.
          "data-rail": l.id,
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
