// ticker.ts — the breaking-news strip under the status bar, World-Monitor
// style ("Live News per-channel tabs" + a marquee). Default tab is 全部
// (special-traffic + 政府治安直擊 merged); 政府 / 交通 / RTHK isolate one
// channel. It only ever shows REAL headlines from the official feeds; when a
// tab's feeds are empty it says so instead of looping silence.
//
// prefers-reduced-motion turns the marquee into a static strip (required).

import { clear, h } from "../lib/dom.ts";
import { parseRss, parseSpecialTraffic } from "../lib/parsers.ts";
import { fetchSource, type Registry } from "../lib/sources.ts";
import { lang } from "../lib/i18n.ts";

const POLL_MS = 5 * 60_000;
const SPACER = "　▪　";
/** Reading speed of the marquee: pixels of headline per second. Chosen so a
 *  typical 30-character Chinese headline takes ~11s to cross — slow enough to
 *  read, and identical on every tab regardless of how many headlines it has. */
const PX_PER_SECOND = 42;

interface Tab {
  id: string;
  label: { tc: string; en: string };
  sources: string[]; // registry ids feeding this tab
}

const TABS: Tab[] = [
  { id: "all", label: { tc: "全部", en: "All" }, sources: ["td_specialtrafficnews", "gov_news_law_order"] },
  { id: "gov", label: { tc: "政府", en: "Gov" }, sources: ["gov_news_law_order"] },
  { id: "traffic", label: { tc: "交通", en: "Traffic" }, sources: ["td_specialtrafficnews"] },
  { id: "rthk", label: { tc: "RTHK", en: "RTHK" }, sources: ["rthk_local"] },
];

export function createTicker(root: HTMLElement, registry: Registry): void {
  let currentTab = "all";

  const track = h("div", { class: "ticker-track", role: "marquee", "aria-label": lang() === "tc" ? "即時消息" : "live headlines" });
  const tabsEl = h("div", { class: "ticker-tabs", role: "tablist" });
  // The marquee animates translateX(-50%) over a very wide track. It MUST live
  // inside its own clipping viewport, otherwise the sliding text travels left
  // across the LIVE tag and the tabs (measured in a screenshot review).
  const viewport = h("div", { class: "ticker-viewport" }, track);
  const frame = h("div", { class: "ticker-frame" }, h("span", { class: "ticker-tag" }, "LIVE"), tabsEl, viewport);
  root.replaceChildren(frame);
  root.hidden = false;

  function paintTabs(): void {
    clear(tabsEl);
    for (const tab of TABS) {
      tabsEl.append(
        h(
          "button",
          {
            type: "button",
            class: "ticker-tab",
            role: "tab",
            "aria-selected": String(tab.id === currentTab),
            onclick: () => {
              if (currentTab === tab.id) return;
              currentTab = tab.id;
              paintTabs();
              void collect().then(paint);
            },
          },
          lang() === "tc" ? tab.label.tc : tab.label.en,
        ),
      );
    }
  }

  async function collect(): Promise<string[]> {
    const items: string[] = [];
    const tab = TABS.find((t) => t.id === currentTab) ?? TABS[0]!;
    for (const id of tab.sources) {
      try {
        const src = registry.byId.get(id);
        if (!src) continue;
        const txt = await (await fetchSource(src)).text();
        if (id === "td_specialtrafficnews") {
          items.push(...parseSpecialTraffic(txt).items.map((i) => i.title));
        } else {
          items.push(...parseRss(txt, 8).items.map((i) => i.title));
        }
      } catch {
        // A dead feed must not blank the whole ticker: it keeps the last output.
      }
    }
    return items;
  }

  function paint(headlines: string[]): void {
    clear(track);
    if (headlines.length === 0) {
      track.textContent = lang() === "tc" ? "現時無相關消息" : "No headlines right now";
      return;
    }
    const text = [...headlines, ...headlines].join(SPACER);
    track.textContent = `${text}${SPACER}`;
    // Speed must be CONSTANT, not per-tab. A fixed 60s duration made the long
    // 全部/交通 lists race past (they are several times longer than RTHK's) —
    // measure the rendered width and derive the duration from a fixed
    // pixels-per-second, so every tab scrolls at the same reading speed.
    // The track is laid out inside .ticker-viewport, so scrollWidth is the
    // full un-clipped width.
    requestAnimationFrame(() => {
      const px = track.scrollWidth / 2; // one copy (content is duplicated)
      if (px <= 0) return;
      const seconds = Math.max(30, Math.round(px / PX_PER_SECOND));
      track.style.animationDuration = `${seconds}s`;
    });
  }

  paintTabs();
  void collect().then(paint);
  window.setInterval(() => void collect().then(paint), POLL_MS);
}