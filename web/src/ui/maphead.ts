// maphead.ts — the map's instrument placard.
//
// World Monitor heads its map with "GLOBAL SITUATION / TUE, 22 SEP 2026
// 16:47:45 UTC": upper-case, letter-spaced, left scope + right timestamp. It
// reads as an instrument marking rather than a page title, and it answers the
// two questions a map of live data has to answer before anything else — what
// am I looking at, and as of when.
//
// Deliberately NOT the same job as the status bar: the status bar reports
// system health (freshness, source count, basemap), this reports scope + time.

import { lang } from "../lib/i18n.ts";

export interface MapHead {
  /** Switch the right-hand scope label (e.g. 停水模式 → 水務署停水通知). */
  setScope(tc: string, en: string): void;
  destroy(): void;
}

const HK_TZ = "Asia/Hong_Kong";

/** "TUE, 22 SEP 2026 16:47:45 HKT" — fixed-width parts so the seconds do not
    make the whole line jitter as it ticks. */
function stamp(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: HK_TZ,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday").toUpperCase()}, ${get("day")} ${get("month").toUpperCase()} ${get("year")} ${get("hour")}:${get("minute")}:${get("second")} HKT`;
}

export function createMapHead(el: HTMLElement): MapHead {
  const scope = el.querySelector<HTMLElement>(".mh-scope");
  const clock = el.querySelector<HTMLElement>(".mh-clock");

  const tick = () => {
    if (clock) clock.textContent = stamp(new Date());
  };
  tick();
  const timer = window.setInterval(tick, 1000);

  return {
    setScope(tc: string, en: string) {
      if (!scope) return;
      scope.dataset["tc"] = tc;
      scope.dataset["en"] = en;
      scope.textContent = lang() === "tc" ? tc : en;
    },
    destroy() {
      window.clearInterval(timer);
    },
  };
}

/** Re-label for a language switch without waiting for the next mode change. */
export function relabelMapHead(el: HTMLElement): void {
  const scope = el.querySelector<HTMLElement>(".mh-scope");
  if (!scope) return;
  const key = lang() === "tc" ? "tc" : "en";
  const text = scope.dataset[key];
  if (text) scope.textContent = text;
}
