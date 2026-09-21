// i18n — Hong Kong's official languages are Traditional Chinese and English,
// carried as two values of the SAME field ({ tc, en }), never as _zh/_en twin
// fields which drift (PRIMITIVES §2.5). Default language is 繁體中文 (Cyrus,
// 2026-09-18). A missing translation fails the build via validate_config.py;
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
