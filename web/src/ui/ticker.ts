// ticker.ts — the breaking-news strip under the status bar, World-Monitor style.
//
// CLASSIFIED BY NEWS TYPE. Cyrus: "The news ticker should classify into different
// news types (public, sports, finance ... etc)."
//
// The taxonomy is the PUBLISHERS' OWN, not a keyword guess. RTHK publishes one
// RSS per editorial section (本地/國際/兩岸/財經/體育) and news.gov.hk one per
// government category, so the category is a property of the SOURCE. That matters
// for the project's honesty rule: a classifier I invented would be an opinion
// about the headline, whereas "this came from RTHK's finance feed" is a fact that
// can be checked against the feed URL in the panel footer.
//
// Every headline carries an inline category tag, so the classification survives
// in the merged 全部 view — which is the default, and where a reader otherwise has
// no way to tell a sports result from a traffic closure. The tabs then let a
// reader isolate one type.
//
// DEDUPE IS NOT OPTIONAL. MEASURED 2026-09-24: the news.gov.hk category feeds
// overlap heavily — admin, finance, health and school_work all returned the SAME
// newest headline (資助人工智能研發 成果轉化惠民). One press release is filed under
// every category it touches, so without dedupe the 政府 tab would show the same
// sentence four times in a row. (Four of the six feeds merged into that tab, plus
// gov_news_finance which is not merged — see the CATS entry.)
//
// It only ever shows REAL headlines from the official feeds, and it distinguishes
// "these sources have nothing to say" from "these sources could not be read" —
// asserting calm it cannot see would be worse than saying nothing.
//
// prefers-reduced-motion turns the marquee into a static strip (required).

import { clear, h } from "../lib/dom.ts";
import { parseRss, parseSpecialTraffic } from "../lib/parsers.ts";
import { fetchSource, type Registry } from "../lib/sources.ts";
import { lang } from "../lib/i18n.ts";

const POLL_MS = 5 * 60_000;
const SPACER = "　▪　";
/** Reading speed of the marquee: pixels of headline per second.
 *
 *  The number that matters is this RATE, and it is deliberately independent of
 *  how many headlines a tab holds — the duration is derived from the measured
 *  track width, so 全部 (79 headlines) and 體育 (8) scroll at the same speed.
 *  A typical 30-character Chinese headline is ~330px at 11px, so it passes a
 *  fixed point in ~8s.
 *
 *  An earlier version of this comment claimed ~11s, which does not follow from
 *  42px/s and was never measured; the constant was tuned by eye and the prose
 *  was written to match the intent rather than the arithmetic. */
const PX_PER_SECOND = 42;

interface L10n {
  tc: string;
  en: string;
}

/** One news type. `sources` are registry ids — the publisher's own sections. */
interface Cat {
  id: string;
  label: L10n;
  sources: string[];
}

/** The publishers' categories. Order is the tab order. */
const CATS: Cat[] = [
  { id: "local", label: { tc: "本地", en: "Local" }, sources: ["rthk_local"] },
  { id: "world", label: { tc: "國際", en: "World" }, sources: ["rthk_world"] },
  { id: "china", label: { tc: "兩岸", en: "China" }, sources: ["rthk_china"] },
  { id: "finance", label: { tc: "財經", en: "Finance" }, sources: ["rthk_finance"] },
  { id: "sport", label: { tc: "體育", en: "Sport" }, sources: ["rthk_sport"] },
  {
    id: "gov",
    label: { tc: "政府", en: "Gov" },
    // The government category feeds merged into one tab. They overlap heavily
    // (see the note at the top), so dedupe matters most here.
    //
    // gov_news_finance is deliberately NOT listed: this tab is for government
    // announcements, and financial news already has its own 財經 tab fed by
    // RTHK's finance section. Without this note a reader counting the registry's
    // seven gov_news_* categories would think one had been dropped by mistake.
    sources: [
      "gov_news_law_order",
      "gov_news_admin",
      "gov_news_environment",
      "gov_news_health",
      "gov_news_infrastructure",
      "gov_news_school_work",
    ],
  },
  { id: "traffic", label: { tc: "交通", en: "Traffic" }, sources: ["td_specialtrafficnews"] },
];

/** Tab order: 全部 first, then one per type. */
const TAB_IDS = ["all", ...CATS.map((c) => c.id)];

interface Headline {
  title: string;
  cat: Cat;
}

export function createTicker(root: HTMLElement, registry: Registry): void {
  let currentTab = "all";
  /** Bumped on every tab change. An in-flight collect that started under an
      older token must not paint over a newer one — MEASURED 2026-09-24: clicking
      through tabs could leave a stale category's headlines on screen, because
      `collect().then(paint)` has no ordering guarantee and a slow fetch for the
      PREVIOUS tab can resolve after the new one. Same class as the layer-control
      race in main.ts. */
  let collectGen = 0;

  // The marquee animates translateX(-50%) over a very wide track. It MUST live
  // inside its own clipping viewport, otherwise the sliding text travels left
  // across the LIVE tag and the tabs (measured in a screenshot review).
  const track = h("div", { class: "ticker-track", role: "marquee", "aria-label": lang() === "tc" ? "即時消息" : "live headlines" });
  const tabsEl = h("div", { class: "ticker-tabs", role: "tablist" });
  const viewport = h("div", { class: "ticker-viewport" }, track);
  const frame = h("div", { class: "ticker-frame" }, h("span", { class: "ticker-tag" }, "LIVE"), tabsEl, viewport);
  root.replaceChildren(frame);
  root.hidden = false;

  const tabLabel = (id: string): string => {
    if (id === "all") return lang() === "tc" ? "全部" : "All";
    const c = CATS.find((x) => x.id === id);
    return c ? (lang() === "tc" ? c.label.tc : c.label.en) : id;
  };

  function paintTabs(): void {
    clear(tabsEl);
    for (const id of TAB_IDS) {
      tabsEl.append(
        h(
          "button",
          {
            type: "button",
            class: "ticker-tab",
            role: "tab",
            "aria-selected": String(id === currentTab),
            "data-cat": id,
            onclick: () => {
              if (currentTab === id) return;
              currentTab = id;
              paintTabs();
              const gen = ++collectGen;
              void collect().then((r) => {
                if (gen === collectGen) paint(r);
              });
            },
          },
          tabLabel(id),
        ),
      );
    }
  }

  /** Which categories a tab draws from: one, or all of them for 全部. */
  const catsForTab = (tab: string): Cat[] =>
    tab === "all" ? CATS : CATS.filter((c) => c.id === tab);

  /** What a collect produced. `failed` counts sources we could not read at all,
      which is NOT the same as them being empty. */
  interface Collected {
    items: Headline[];
    sources: number;
    failed: number;
  }

  async function collect(): Promise<Collected> {
    const out: Headline[] = [];
    let sources = 0;
    let failed = 0;
    for (const cat of catsForTab(currentTab)) {
      for (const id of cat.sources) {
        sources++;
        try {
          const src = registry.byId.get(id);
          if (!src) {
            failed++;
            continue;
          }
          const txt = await (await fetchSource(src)).text();
          // The traffic feed is NOT RSS: it uses <message>/<ChinText>, so the
          // generic parser returns nothing for it (measured — a generic <item>
          // count on that URL is 0 while the feed is full of notices).
          const titles =
            id === "td_specialtrafficnews"
              ? parseSpecialTraffic(txt).items.map((i) => i.title)
              : parseRss(txt, 8).items.map((i) => i.title);
          for (const title of titles) out.push({ title, cat });
        } catch {
          // Count it rather than swallowing it. A dead feed must not blank the
          // whole ticker, but it also must not be reported as "no news" — those
          // are different claims and this project does not conflate them.
          failed++;
        }
      }
    }
    // Dedupe by headline across the WHOLE selection, keeping the first category
    // that carried it. Press releases are filed under several categories, so
    // without this the 政府 tab repeats one sentence once per category it
    // matched. First-wins is arbitrary but stable, and the tag still tells the
    // reader which feed it was actually read from.
    const seen = new Set<string>();
    const items = out.filter((it) => {
      const k = it.title.trim();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { items, sources, failed };
  }

  function paint(res: Collected): void {
    clear(track);
    const { items, sources, failed } = res;
    if (items.length === 0) {
      // Distinguish the two reasons a ticker can be empty. Showing "現時無相關消息"
      // (no news right now) when every feed actually FAILED would be the
      // dashboard asserting calm it cannot see — the exact dishonesty the
      // honesty-state model exists to prevent.
      const allFailed = failed > 0 && failed === sources;
      track.textContent = allFailed
        ? lang() === "tc"
          ? "消息來源暫時讀唔到"
          : "Headlines unavailable right now"
        : lang() === "tc"
          ? "現時無相關消息"
          : "No headlines right now";
      track.style.animationDuration = "";
      return;
    }
    // The marquee loops by duplicating its content and translating -50%, so the
    // two copies must be byte-identical for the seam to be invisible.
    const copy = (): (HTMLElement | string)[] => {
      const nodes: (HTMLElement | string)[] = [];
      for (const it of items) {
        nodes.push(
          h(
            "span",
            { class: "tk-item" },
            // The category, inline. This is what makes 全部 readable: a reader
            // can tell a sports result from a traffic closure without clicking.
            h("span", { class: `tk-cat c-${it.cat.id}` }, lang() === "tc" ? it.cat.label.tc : it.cat.label.en),
            h("span", { class: "tk-title" }, it.title),
          ),
        );
        nodes.push(SPACER);
      }
      return nodes;
    };
    track.append(...copy(), ...copy());
    // Speed must be CONSTANT, not per-tab. A fixed 60s duration made the long
    // 全部 list race past (it is several times longer than 體育's) — measure the
    // rendered width and derive the duration from a fixed pixels-per-second, so
    // every tab scrolls at the same reading speed.
    // The track is laid out inside .ticker-viewport, so scrollWidth is the full
    // un-clipped width.
    requestAnimationFrame(() => {
      const px = track.scrollWidth / 2; // one copy (content is duplicated)
      if (px <= 0) return;
      const seconds = Math.max(30, Math.round(px / PX_PER_SECOND));
      track.style.animationDuration = `${seconds}s`;
    });
  }

  paintTabs();
  const gen0 = ++collectGen;
  void collect().then((r) => {
    if (gen0 === collectGen) paint(r);
  });
  window.setInterval(() => {
    const gen = ++collectGen;
    void collect().then((r) => {
      if (gen === collectGen) paint(r);
    });
  }, POLL_MS);

  // QA hooks: the classification is a claim about the DOM, so it must be
  // assertable without scraping rendered text.
  (root as unknown as Record<string, unknown>)["__ticker"] = {
    tabs: () => TAB_IDS.slice(),
    current: () => currentTab,
    categories: () => CATS.map((c) => ({ id: c.id, tc: c.label.tc, en: c.label.en, sources: c.sources.slice() })),
    shown: () =>
      [...track.querySelectorAll(".tk-item")].slice(0, itemsShown()).map((el) => ({
        cat: el.querySelector(".tk-cat")?.textContent?.trim() ?? "",
        title: el.querySelector(".tk-title")?.textContent?.trim() ?? "",
      })),
  };
  /** One copy's worth of items — the track holds two identical copies. */
  function itemsShown(): number {
    return Math.floor(track.querySelectorAll(".tk-item").length / 2);
  }
}
