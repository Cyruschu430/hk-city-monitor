// theme.ts — Dark / Light / System. Mirrors i18n.ts deliberately: one key, one
// localStorage entry, one attribute on <html>.
//
// The attribute lives on <html>, not a class on <body>, because it has to be
// readable before the body exists — the pre-paint script in index.html sets it
// from localStorage so a light-theme user never sees a black flash on load.
//
// Light is NOT an inversion of the dark tokens. A dashboard's signal colours
// carry MEANING (red = critical, and red = up on the HK market convention), so
// the surfaces flip while the semantics stay put; the accents are darkened
// because #22d3ee on white is unreadable as text.

export type Theme = "system" | "light" | "dark";

const KEY = "hkcm.theme";
const listeners = new Set<(t: Theme) => void>();

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "system" || v === "light" || v === "dark") return v;
  } catch {
    /* private mode — fall through to the default */
  }
  return "system";
}

const mq = (): MediaQueryList | null =>
  typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

let current: Theme = read();

export function resolved(t: Theme = current): "light" | "dark" {
  if (t === "system") return mq()?.matches ? "dark" : "light";
  return t;
}

export function theme(): Theme {
  return current;
}

export function apply(): void {
  document.documentElement.dataset["theme"] = resolved();
}

export function setTheme(next: Theme): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* non-persistent is acceptable; the choice still holds for the session */
  }
  apply();
  for (const fn of listeners) fn(next);
}

export function onThemeChange(fn: (t: Theme) => void): void {
  listeners.add(fn);
}

// Module side effects, the same shape as i18n.ts reading its key at load.
apply();
// Follow the OS while System is selected: a user who switches their machine at
// dusk expects the dashboard to follow without touching it.
mq()?.addEventListener("change", () => {
  if (current === "system") {
    apply();
    for (const fn of listeners) fn(current);
  }
});
