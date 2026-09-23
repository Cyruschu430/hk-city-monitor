// grouptabs.ts — the category strip above the panel column.
//
// The categories are NOT a new taxonomy. They are the `group` field every
// source already carries in sources.json, read back through the panel's source
// — one registry, so a new panel lands in the right tab with no edit here, and
// this file can never invent a second classification that drifts from the data.
//
// Labels live here rather than in a data file because a group id is a stable
// English token (weather, transport, …). An unlabelled group falls back to the
// raw id: ugly, but honest. A silent drop would hide real sources.

import { h } from "../lib/dom.ts";
import { lang } from "../lib/i18n.ts";
import type { L10n } from "../lib/i18n.ts";

const LABELS: Record<string, L10n> = {
  weather: { tc: "天氣", en: "Weather" },
  civic: { tc: "民生", en: "Civic" },
  transport: { tc: "交通", en: "Transport" },
  news: { tc: "新聞", en: "News" },
  geospatial: { tc: "地理空間", en: "Geospatial" },
  prices: { tc: "物價", en: "Prices" },
  border: { tc: "口岸", en: "Border" },
  aviation: { tc: "航空", en: "Aviation" },
  cameras: { tc: "鏡頭", en: "Cameras" },
  marine: { tc: "海事", en: "Marine" },
  market: { tc: "財經", en: "Markets" },
  global: { tc: "國際", en: "Global" },
};

const ALL: L10n = { tc: "全部", en: "All" };

export function labelFor(id: string): L10n {
  return LABELS[id] ?? { tc: id, en: id };
}

export interface GroupTab {
  id: string;
  label: L10n;
  count: number;
}

export interface GroupTabs {
  /** Rebuild from the panels currently in the mode. An `active` group the mode
      no longer contains is dropped back to 全部. */
  setTabs(tabs: GroupTab[], active: string | null): void;
  setActive(id: string | null): void;
}

export function createGroupTabs(root: HTMLElement, onPick: (id: string | null) => void): GroupTabs {
  let tabs: GroupTab[] = [];
  let active: string | null = null;
  let total = 0;
  const buttons = new Map<string, HTMLElement>(); // key "" is 全部

  function make(key: string, label: L10n, count: number): HTMLElement {
    return h(
      "button",
      {
        class: "ptab",
        type: "button",
        role: "tab",
        "data-group": key,
        onclick: () => onPick(key === "" ? null : key),
      },
      lang() === "tc" ? label.tc : label.en,
      h("span", { class: "n" }, String(count)),
    );
  }

  function paint(): void {
    const want = active ?? "";
    for (const [key, b] of buttons) b.setAttribute("aria-selected", String(key === want));
  }

  function build(): void {
    root.replaceChildren();
    buttons.clear();
    const all = make("", ALL, total);
    buttons.set("", all);
    root.append(all);
    for (const t of tabs) {
      const b = make(t.id, t.label, t.count);
      buttons.set(t.id, b);
      root.append(b);
    }
    paint();
  }

  return {
    setTabs(next, nextActive) {
      tabs = next;
      total = next.reduce((n, t) => n + t.count, 0);
      active = nextActive !== null && next.some((t) => t.id === nextActive) ? nextActive : null;
      build();
    },
    setActive(id) {
      active = id;
      paint();
    },
  };
}
