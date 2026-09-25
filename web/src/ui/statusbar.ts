// statusbar.ts — the 40px instrument strip: identity, live pulse, and the
// discrete readouts a control room keeps in the corner. Readouts are LABEL +
// VALUE cells rather than one run-on sentence, so each number is scannable and
// has a fixed home (a value that moves around reads as an amateur dashboard).

import { clear, h } from "../lib/dom.ts";
import { clockNow } from "../lib/format.ts";
import { lang, setLang, onLangChange, type Lang } from "../lib/i18n.ts";
import { onThemeChange, setTheme, theme, type Theme } from "../lib/theme.ts";

export interface StatusBar {
  setCameras(td: number, hko: number): void;
  setMode(name: string): void;
  setTiles(via: string): void;
  /** readout for the currently active vertical's data age, if any */
  setFreshness(text: string, state: "ok" | "warn" | "bad"): void;
  /** The coverage line: what fraction of the catalog is actually on screen and
      working right now. Numbers must come from runtime, never a literal. */
  setCoverage(s: { live: number; total: number; error: number; stale: number; catalog: number }): void;
}

/** One label+value readout cell.
 *
 * The label is BILINGUAL and returned so it can be relabelled on a language
 * switch. MEASURED 2026-09-25 (web/scripts/probe-en-audit.mjs): these labels were
 * hardcoded Chinese — 狀態 / 模式 / 相機 / 底圖 — so the EN UI showed Chinese in its
 * most prominent strip. They were created once and never revisited, which is why
 * the language switch appeared to work while this row did not change.
 */
function stat(label: string, value: HTMLElement | string, extraClass = ""): HTMLElement {
  return h("div", { class: `stat ${extraClass}` }, h("span", { class: "stat-label" }, label), h("span", { class: "stat-value" }, value));
}

/** Every label in the strip, in one place, so a language switch cannot miss one. */
const LABELS = {
  fresh: { tc: "狀態", en: "Status" },
  mode: { tc: "模式", en: "Mode" },
  cams: { tc: "相機", en: "Cameras" },
  basemap: { tc: "底圖", en: "Basemap" },
  direct: { tc: "LandsD 直連", en: "LandsD direct" },
  worker: { tc: "Worker 快取", en: "Worker cache" },
} as const;

export function createStatusBar(root: HTMLElement): StatusBar {
  clear(root);
  const pulse = h("span", { class: "live-pulse", title: "live" });
  const modeEl = h("span", {});
  const camsEl = h("span", {});
  const tilesEl = h("span", {});
  const clockEl = h("span", {});
  const freshEl = h("span", {});
  const freshDot = h("i", { class: "stat-dot" });
  const langBox = h("div", { id: "langSwitch", role: "group", "aria-label": "language" });

  const buttons = new Map<Lang, HTMLElement>();
  for (const [code, label] of [["tc", "繁中"], ["en", "EN"]] as [Lang, string][]) {
    const b = h("button", { type: "button", onclick: () => setLang(code) }, label);
    b.setAttribute("aria-pressed", String(lang() === code));
    buttons.set(code, b);
    langBox.append(b);
  }
  const syncPressed = () => {
    for (const [code, b] of buttons) b.setAttribute("aria-pressed", String(lang() === code));
  };
  syncPressed();

  // Theme switch — the same pill, one row up from the language switch it sits
  // beside. Labels ARE translated (unlike 繁中/EN, which are language names and
  // conventionally written in their own language).
  const THEME_LABELS: Record<Theme, { tc: string; en: string }> = {
    system: { tc: "自動", en: "Auto" },
    light: { tc: "淺色", en: "Light" },
    dark: { tc: "深色", en: "Dark" },
  };
  const themeBox = h("div", { id: "themeSwitch", role: "group", "aria-label": "theme" });
  const themeButtons = new Map<Theme, HTMLElement>();
  for (const code of ["system", "light", "dark"] as Theme[]) {
    const b = h("button", { type: "button", onclick: () => setTheme(code) }, "");
    themeButtons.set(code, b);
    themeBox.append(b);
  }
  const syncTheme = () => {
    const tc = lang() === "tc";
    for (const [code, b] of themeButtons) {
      b.textContent = tc ? THEME_LABELS[code].tc : THEME_LABELS[code].en;
      b.setAttribute("aria-pressed", String(theme() === code));
    }
  };
  syncTheme();
  onThemeChange(syncTheme);

  const freshStat = stat(LABELS.fresh[lang() === "tc" ? "tc" : "en"], h("span", {}, freshDot, freshEl), "stat-fresh");
  const modeStat = stat(LABELS.mode[lang() === "tc" ? "tc" : "en"], modeEl);
  const camsStat = stat(LABELS.cams[lang() === "tc" ? "tc" : "en"], camsEl, "hide-s");
  const tilesStat = stat(LABELS.basemap[lang() === "tc" ? "tc" : "en"], tilesEl, "hide-s");
  // Kept so a language switch can relabel them: the four cells above are created
  // once, and `syncLang` below is the only thing that may change their text.
  const labelCells: [HTMLElement, keyof typeof LABELS][] = [
    [freshStat, "fresh"],
    [modeStat, "mode"],
    [camsStat, "cams"],
    [tilesStat, "basemap"],
  ];
  /** What the basemap cell is currently reporting, so relabelling it does not
      have to guess between the two values. */
  let tilesVia: "direct" | "worker" = "worker";

  // The four readout LABELS and the basemap VALUE are language-dependent, and they
  // are built once, so a language switch has to walk them explicitly. Same shape
  // as Pitfall 15 (a preference painted only from its change event): the parts
  // that DO update are the visible ones, which is what makes a half-translated
  // strip look like a working language switch.
  const syncLang = () => {
    const tc = lang() === "tc";
    for (const [cell, key] of labelCells) {
      const el = cell.querySelector<HTMLElement>(".stat-label");
      if (el) el.textContent = tc ? LABELS[key].tc : LABELS[key].en;
    }
    tilesEl.textContent = LABELS[tilesVia === "direct" ? "direct" : "worker"][tc ? "tc" : "en"];
  };
  onLangChange(syncLang);

  // Coverage strip. World Monitor's footer reads "Digest coverage: complete —
  // 116 publishers, 295 items, feeds 234/245, categories 17/17". That sentence
  // IS this project's honesty principle, but worn as chrome instead of hidden
  // in a panel corner. We have a large catalog and only a slice of it surfaced
  // at any moment — not saying so would be the misleading option.
  const coverEl = h("span", { class: "cover-text" });
  const coverWrap = h("div", { class: "coverage", title: "" }, h("span", { class: "cover-dot" }), coverEl);

  root.append(
    h(
      "div",
      { class: "sb-row1" },
      h("div", { class: "brand" }, pulse, h("h1", {}, "HK CITY MONITOR"), h("span", { class: "sub" }, "香港城市監察")),
      h(
        "div",
        { class: "meta" },
        freshStat,
        modeStat,
        camsStat,
        tilesStat,
        stat("HKT", clockEl),
        langBox,
        themeBox,
      ),
    ),
    coverWrap,
  );

  const timer = window.setInterval(() => (clockEl.textContent = clockNow()), 1000);
  clockEl.textContent = clockNow();
  window.addEventListener("beforeunload", () => window.clearInterval(timer));

  return {
    setCameras(td, hko) {
      camsEl.textContent = (td + hko).toLocaleString("en-US");
    },
    setMode(name) {
      modeEl.textContent = name;
    },
    setTiles(via) {
      // Remember which value is showing, so syncLang can re-render it in the
      // other language without re-deriving it from the network state.
      tilesVia = via === "direct" ? "direct" : "worker";
      tilesEl.textContent = LABELS[tilesVia === "direct" ? "direct" : "worker"][lang() === "tc" ? "tc" : "en"];
    },
    setFreshness(text, state) {
      freshEl.textContent = text;
      freshStat.setAttribute("data-fresh", state);
    },
    setCoverage(s) {
      const tc = lang() === "tc";
      // "來源" here means the sources behind the panels currently mounted, not
      // the whole catalog — the catalog figure is stated separately so the two
      // can never be read as the same claim.
      const parts: string[] = [];
      parts.push(tc ? `${s.live}/${s.total} 個面板來源正常` : `${s.live}/${s.total} panel sources healthy`);
      if (s.error > 0) parts.push(tc ? `${s.error} 個出錯` : `${s.error} failed`);
      if (s.stale > 0) parts.push(tc ? `${s.stale} 個過期` : `${s.stale} stale`);
      parts.push(tc ? `目錄共 ${s.catalog} 個源` : `${s.catalog} in catalog`);
      coverEl.textContent = (tc ? "覆蓋：" : "Coverage: ") + parts.join(" · ");
      coverWrap.setAttribute("data-health", s.error > 0 ? "bad" : s.stale > 0 ? "warn" : "ok");
    },
  };
}
