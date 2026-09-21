// ticker.ts — the breaking-news strip under the status bar, World-Monitor
// style: a horizontal marquee of the latest special-traffic and 突發 news
// headlines. It only ever shows REAL headlines fetched from the official
// feeds; when both feeds are empty it says so instead of looping silence.
//
// prefers-reduced-motion turns the marquee into a static strip (required).

import { clear, h } from "../lib/dom.ts";
import { parseRss, parseSpecialTraffic } from "../lib/parsers.ts";
import { fetchSource, type Registry } from "../lib/sources.ts";
import { lang } from "../lib/i18n.ts";

const POLL_MS = 5 * 60_000;
const SPACER = "　▪　";

export function createTicker(root: HTMLElement, registry: Registry): void {
  const track = h("div", { class: "ticker-track", role: "marquee", "aria-label": lang() === "tc" ? "即時消息" : "live headlines" });
  const frame = h("div", { class: "ticker-frame" }, h("span", { class: "ticker-tag" }, "LIVE"), track);
  root.replaceChildren(frame);
  root.hidden = false;

  async function collect(): Promise<string[]> {
    const items: string[] = [];
    try {
      const stn = registry.byId.get("td_specialtrafficnews");
      if (stn) {
        const xml = await (await fetchSource(stn)).text();
        items.push(...parseSpecialTraffic(xml).items.map((i) => i.title));
      }
      const law = registry.byId.get("gov_news_law_order");
      if (law) {
        const xml = await (await fetchSource(law)).text();
        items.push(...parseRss(xml, 8).items.map((i) => i.title));
      }
    } catch {
      // A dead feed must not blank the whole ticker: it keeps the last output.
    }
    return items;
  }

  function paint(headlines: string[]): void {
    clear(track);
    if (headlines.length === 0) {
      track.textContent = lang() === "tc" ? "現時無特別交通消息或突發新聞" : "No live headlines right now";
      return;
    }
    // Duplicate once so the marquee can loop seamlessly.
    const text = [...headlines, ...headlines].join(SPACER);
    track.textContent = `${text}${SPACER}`;
  }

  void collect().then(paint);
  window.setInterval(() => void collect().then(paint), POLL_MS);
}