// rail.ts — the 56px left rail: the MODE switcher (總覽 + every vertical from
// verticals.json). Icons are inline SVG with 1.5px stroke —
// never an emoji, never an icon font.
//
// Verticals are DATA: this file renders whatever verticals.json contains and
// knows nothing about typhoons or water. That is what makes Run 5 a config run.
//
// WHY THE LAYER ICONS ARE GONE (Cyrus, 2026-10-01: "堆icon panel is abundant").
// This rail used to carry a second stack of toggles below a separator — cameras,
// rain, imagery, aircraft, wind, stations, drone zones, AEDs, cargo areas: 12 more
// 1.5px glyphs, which put 23 near-identical buttons in a 56px column where the
// user's job is choosing a MODE, not auditing a layer inventory.
//
// Nothing was lost by removing them, and that is checkable rather than asserted:
// `main.ts` synthesises a LAYERS row for every entry in RAIL_LAYERS, so each of
// those 12 toggles already had a labelled row with a checkbox, a glyph, an ⓘ and
// a ✕ in the map face's LAYERS control — the control that can also search and
// filter them as of the same change. One control per job: the rail picks the
// question, the LAYERS control picks what is drawn.
//
// If a layer toggle is ever wanted back on the rail, the argument is not "it is
// convenient" — it is what a RAIL row could not already do.

import { h, icon } from "../lib/dom.ts";
import { lang, onLangChange } from "../lib/i18n.ts";
import type { VerticalDefRaw } from "../lib/sources.ts";

export interface RailCallbacks {
  onMode(id: string): void;
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

export interface RailHandle {
  setActive(id: string): void;
}

export function createRail(
  root: HTMLElement,
  verticals: VerticalDefRaw[],
  cb: RailCallbacks,
): RailHandle {
  const modeButtons = new Map<string, HTMLElement>();

  const build = () => {
    root.replaceChildren();
    modeButtons.clear();

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
          // measuring a different element entirely.) With the layer icons gone the
          // first pressed rail button IS a mode button, so that check now measures
          // the thing it was written for.
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
  };
}
