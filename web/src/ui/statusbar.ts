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
  /** Fill the mode picker. Called once the registry has loaded, and again on a language
      switch: the list is DATA (verticals.json), which is the property the rail had and
      the reason this control did not need any mode names written into it. */
  setModes(modes: { id: string; label: string; title?: string }[], onMode: (id: string) => void): void;
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
  // THE MODE CONTROL LIVES HERE NOW (Cyrus 2026-10-01: "Remove 最左個icon bar menu").
  // The rail was a 56px column of 1.5px glyphs whose whole job was picking one of ten
  // values, next to a header that already had to print which value was active ("模式 總覽").
  // A readout and a control for the same fact, 56px apart, is one control too many — the
  // header prints it and changes it, and the map gets the 56px back.
  const modeEl = document.createElement("select");
  modeEl.className = "mode-sel";
  modeEl.setAttribute("aria-label", "模式 / mode");
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

  // ONE theme button, not four (Cyrus 2026-10-01: "改成一個THEME BUTTON比USER自己change").
  // Four pills spent 40px of a 40px strip on a control a reader touches twice in a
  // session, and they read as four unrelated switches rather than one choice with four
  // values. The button now shows the CURRENT theme and cycles on click, which keeps the
  // answer ("what theme am I on?") on the control instead of in whichever pill happens
  // to look pressed.
  //
  // The fourth theme is called 指揮 / Command. It was labelled with the name of the design
  // system's vendor — a style named after a company reads as an endorsement on a public
  // repo, so the visible string is generic now while the token values keep their citation
  // in tokens.css.
  const THEME_ORDER: Theme[] = ["system", "light", "dark", "command"];
  const THEME_LABELS: Record<Theme, { tc: string; en: string }> = {
    system: { tc: "自動", en: "Auto" },
    light: { tc: "淺色", en: "Light" },
    dark: { tc: "深色", en: "Dark" },
    command: { tc: "指揮", en: "Command" },
  };
  const themeBox = h("div", { id: "themeSwitch", role: "group", "aria-label": "theme" });
  const themeBtn = h("button", {
    type: "button",
    onclick: () => {
      const at = THEME_ORDER.indexOf(theme());
      const next = THEME_ORDER[(at + 1) % THEME_ORDER.length]!;
      setTheme(next);
    },
  });
  themeBox.append(themeBtn);
  const syncTheme = () => {
    const tc = lang() === "tc";
    const name = THEME_LABELS[theme()][tc ? "tc" : "en"];
    themeBtn.textContent = lang() === "tc" ? `主題：${name}` : `Theme: ${name}`;
    themeBtn.title = tc
      ? `而家係「${name}」— 撳一下換下一個`
      : `Currently ${name} — click for the next theme`;
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
  //
  // The credits sit at the far end of the same line (Cyrus 2026-10-01: "Header Footer
  // 加返我自己既personal branding - credits"). It is authorship, not a data claim, so it
  // belongs with the chrome rather than in a panel — and the line it joins is already the
  // one that says where everything else came from.
  const coverEl = h("span", { class: "cover-text" });
  // The coverage line ends with the author and a link to the source. Cyrus asked for his GitHub
  // here specifically (2026-10-01) — this project is his portfolio, and a reader who wants to
  // check a claim should not have to guess where the code is.
  const creditsEl = h(
    "a",
    {
      class: "credits",
      href: "https://github.com/Cyruschu430/hk-city-monitor",
      target: "_blank",
      rel: "noopener noreferrer",
      title: lang() === "tc" ? "作者 · GitHub" : "Author · GitHub",
    },
    lang() === "tc" ? "由 Cyrus Chu 建立 · 資料 © 各發布者" : "Built by Cyrus Chu · data © the publishers",
  );
  const coverWrap = h("div", { class: "coverage", title: "" }, h("span", { class: "cover-dot" }), coverEl, creditsEl);

  root.append(
    h(
      "div",
      { class: "sb-row1" },
      h("div", { class: "brand" }, pulse, h("h1", {}, "HK CITY MONITOR"), h("span", { class: "sub" }, "香港城市監察")),
      h(
        "div",
        { class: "meta" },
        // ponytail: freshStat and tilesStat are still built above and still written to
        // (setFreshness / setTiles) — they are simply not appended any more. Cyrus
        // 2026-10-02: seven cells in one row left "1 stale" with no room for its own
        // label, so it rendered as a bare meaningless number. Freshness is already said
        // per panel and again in the coverage line below, and the basemap is named by
        // the mandatory LandsD attribution on the map face. Removing the cells from the
        // row is the whole fix; deleting the elements would churn three callers.
        modeStat,
        camsStat,
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
      // Accepts an id or a label: main.ts switches by id, older call sites passed the
      // label, and the picker is the only thing that has to agree with itself.
      for (const o of Array.from(modeEl.options)) {
        if (o.value === name || o.textContent === name) {
          modeEl.value = o.value;
          return;
        }
      }
    },
    setModes(modes, onMode) {
      const was = modeEl.value;
      clear(modeEl);
      for (const m of modes) {
        const o = new Option(m.label, m.id, false, m.id === was);
        // The vertical's own question, on the option: "颱風模式 — 會唔會掛 8 號? …".
        if (m.title) o.title = m.title;
        modeEl.append(o);
      }
      modeEl.onchange = () => onMode(modeEl.value);
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
