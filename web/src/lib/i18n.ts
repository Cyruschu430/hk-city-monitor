// i18n — Hong Kong's official languages are Traditional Chinese and English,
// carried as two values of the SAME field ({ tc, en }), never as _zh/_en twin
// fields which drift. Default language is 繁體中文 . A missing translation fails the build via validate_config.py;
// here a missing value is a loud fallback, never a silent empty string.

export type Lang = "tc" | "en";
export type L10n = { tc: string; en: string };

const KEY = "hkcm.lang";
let current: Lang = ((): Lang => {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "tc" || v === "en") return v;
  } catch {
    /* private mode — fall through to default */
  }
  return "tc";
})();

const listeners = new Set<(l: Lang) => void>();

export function lang(): Lang {
  return current;
}

export function setLang(next: Lang): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* non-persistent is acceptable; the switch still works for the session */
  }
  document.documentElement.lang = next === "tc" ? "zh-HK" : "en";
  for (const fn of listeners) fn(next);
}

export function onLangChange(fn: (l: Lang) => void): void {
  listeners.add(fn);
}

/** Pick the current language's value from a bilingual field. */
export function t(label: L10n | null | undefined): string {
  if (!label) return "—";
  return label[current] ?? label.tc ?? label.en ?? "—";
}

/** Same pick, but for an explicit language (tests, non-UI callers). */
export function tl(label: L10n, l: Lang): string {
  return label[l];
}

/** Display names for `Event.domain`.
 *
 * The rule registry carries English slugs (`water`, `health`, …) and they were reaching a
 * Traditional-Chinese panel verbatim: the timeline read `water · traffic · health`, and
 * convergence.ts's own phrased line read `同一時段內同時發生：water, health（…）`. A Chinese
 * dashboard with English internals in it is the gap that never shows up in a test, because the
 * test asserts the value is present — and it is.
 *
 * An UNKNOWN id falls back to the id itself, never to "—" or an empty string. A domain added to
 * rules.json must read as something on the day it is added, and `transport2` tells a reader more
 * than a dash does. It also makes the omission visible instead of silent.
 */
const DOMAIN_LABELS: Record<string, L10n> = {
  water: { tc: "水務", en: "Water" },
  traffic: { tc: "交通", en: "Traffic" },
  transport: { tc: "運輸", en: "Transport" },
  health: { tc: "醫療", en: "Health" },
  weather: { tc: "天氣", en: "Weather" },
  environment: { tc: "環境", en: "Environment" },
  border: { tc: "口岸", en: "Border" },
  civic: { tc: "民生", en: "Civic" },
  aviation: { tc: "航空", en: "Aviation" },
  marine: { tc: "海事", en: "Marine" },
  finance: { tc: "財經", en: "Finance" },
  power: { tc: "電力", en: "Power" },
};

export function domainLabel(id: string): string {
  const l = DOMAIN_LABELS[id];
  return l ? t(l) : id;
}
