// probe-en-audit.mjs — find text that is STILL Chinese when the UI is in English.
//
// Cyrus: "EN version not really all (Content) in English, review please."
//
// Rather than reading every component, switch the app to EN and scan the RENDERED
// DOM for CJK characters. Anything with a Han character in EN mode is a string
// that was never given an English value — either a hardcoded Chinese literal, a
// missing L10n, or a value that came from data (which may be legitimately Chinese
// and must be judged separately).
//
// Output separates the two cases, because they need different fixes:
//   · CHROME  — UI text the app owns (labels, buttons, headings) → must be English
//   · DATA    — a value from a source or registry (a district name, a headline)
//               → legitimately Chinese; the fix is to use the source's English
//                 field where one exists, not to translate it
import { chromium } from "playwright-core";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:4173/";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "en-US" });
await page.addInitScript(() => {
  try {
    localStorage.setItem("hkcm.lang", "en");
  } catch {}
});
await page.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(22_000);

const HAN = /[\u3400-\u9fff\u3040-\u30ff]/;

const scan = await page.evaluate(() => {
  // Walk every element that directly owns text (no element children), so a
  // container's aggregate text is not reported repeatedly.
  const out = [];
  const seen = new Set();
  const walk = (el, path) => {
    for (const child of el.children) {
      const tag = child.tagName;
      if (tag === "SCRIPT" || tag === "STYLE") continue;
      const cls = (child.className || "").toString().split(" ")[0] || "";
      const here = `${path}>${tag.toLowerCase()}${cls ? "." + cls : ""}`;
      const own = [...child.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .filter(Boolean)
        .join(" ");
      if (own) {
        const key = `${here}|${own}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ path: here, text: own.slice(0, 90), lang: child.getAttribute("lang") ?? "" });
        }
      }
      walk(child, here);
    }
  };
  walk(document.body, "body");
  return out;
});

const han = scan.filter((s) => HAN.test(s.text));
// The chrome the app itself owns. Anything in the map/panel area could be DATA.
const CHROME_HINTS = [
  "statusbar", "rail", "maphead", "mh-", "panel-head", "panel-foot",
  "ptab", "lyr-", "p-hide", "chip", "palette", "drawer", "ticker-tab",
  "ticker-tag", "tk-cat", "coverage", "map-coords", "landsd-badge",
];
// Text that is a VALUE FROM A SOURCE, not UI the app wrote. A headline is data;
// the tab label beside it is chrome. These paths carry fetched content.
const DATA_PATHS = ["tk-title", "panel-body", "plist", "ptable", "statuses", "gauges", "an-", "praster", "cam "];
const isChrome = (p) => CHROME_HINTS.some((h) => p.includes(h)) && !DATA_PATHS.some((d) => p.includes(d));
const isData = (p) => DATA_PATHS.some((d) => p.includes(d));

const chromeHan = han.filter((s) => isChrome(s.path));
const dataHan = han.filter((s) => !isChrome(s.path));
console.log(`total text nodes: ${scan.length}   with CJK: ${han.length}`);
console.log(`\n=== CHROME (app-owned UI text — MUST be English) : ${chromeHan.length} ===`);
for (const s of chromeHan.slice(0, 40)) console.log(`  ${s.path}\n      "${s.text}"`);
if (chromeHan.length === 0) console.log("  (none — chrome is fully English)");

console.log(`\n=== DATA (from sources/registry — may be legitimately Chinese) : ${dataHan.length} ===`);
const byPath = new Map();
for (const s of dataHan) {
  const k = s.path.replace(/\d+/g, "N");
  if (!byPath.has(k)) byPath.set(k, []);
  byPath.get(k).push(s.text);
}
for (const [k, v] of [...byPath.entries()].slice(0, 25)) {
  console.log(`  ${k}  x${v.length}`);
  console.log(`      "${v[0]}"`);
}

await browser.close();
