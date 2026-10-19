// browser.mjs — where the browser executable comes from, resolved in ONE place.
//
// WHY THIS EXISTS. Every browser-driven check carried its own fallback path, and that fallback was a
// Windows Playwright install under a literal `<user>` placeholder — so on any machine that was not the
// author's PC (CI, a Linux box, a fresh clone) the gate died with
// "Failed to launch chromium because executable doesn't exist at C:\Users\<user>\...".
// That reads like a broken build, and it hid the real verdict: nothing had been measured yet.
//
// ORDER, and the reason for each step. An explicit override wins, because it is the one thing a caller
// can know that this file cannot. Then Playwright's own answer — but only if that browser is actually
// installed, because Playwright happily returns the path it WOULD use. Then a system browser. If none
// of them exist, return undefined so Playwright raises its own message ("run npx playwright install"),
// which names the fix; a non-existent path never does.
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

function ownBrowser() {
  try {
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.HKCM_CHROME,
  ownBrowser(),
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

export function browserExe() {
  for (const candidate of CANDIDATES) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return undefined;
}
