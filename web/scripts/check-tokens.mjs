// check-tokens.mjs — every `var(--x)` used in the CSS must actually be DEFINED.
//
// MEASURED 2026-09-24: app.css referenced `var(--text)` in three rules, but
// tokens.css defines `--txt`. An undefined custom property makes the declaration
// invalid at computed-value time, so `color` fell back to `inherit` — and the
// LAYERS control picked up the LIGHT theme's near-black (#0b1626) while sitting
// on the dark map face. Measured label colour: rgb(11,22,38) on a dark panel.
// The layer names were effectively invisible, and NOTHING reported an error:
// not tsc, not the build, not the browser console.
//
// This is exactly the class of defect a grep can settle, so it is a script.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const styles = join(web, "src", "styles");

const files = readdirSync(styles).filter((f) => f.endsWith(".css"));
const css = Object.fromEntries(files.map((f) => [f, readFileSync(join(styles, f), "utf8")]));

// Definitions: `--name:` at the start of a declaration, in any stylesheet.
const defined = new Set();
for (const text of Object.values(css)) {
  for (const m of text.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/gi)) defined.add(m[2]);
}

// Uses: `var(--name)` including `var(--name, fallback)`.
const problems = [];
for (const [name, text] of Object.entries(css)) {
  // Strip comments BEFORE scanning, and keep a line map so the reported line
  // number still points at the original source. Block comments span lines, so a
  // per-line regex is not enough — the first version of this script flagged its
  // own explanatory comment for exactly that reason.
  const lineOf = [];
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, (m) => {
    const n = m.split(/\r?\n/).length - 1;
    lineOf.push(n);
    return "\n".repeat(n); // preserve line numbering
  });
  const lines = stripped.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/gi)) {
      const token = m[1];
      const hasFallback = Boolean(m[2]);
      if (!defined.has(token) && !hasFallback) {
        problems.push({ file: name, line: i + 1, token, text: line.trim().slice(0, 96) });
      }
    }
  });
}

// The MAP FACE is always dark, whatever the page theme is. A themed token used
// inside it renders the LIGHT value on a DARK surface.
//
// MEASURED 2026-09-24: `.lyr-label{color:var(--txt)}` looked correct and resolved
// cleanly, but in light mode `--txt` is #0b1626 — near-black on the dark map.
// Measured colour on the live page: rgb(11,22,38). The LAYERS control was
// effectively invisible and NO tool reported anything: tsc, the build and the
// console were all silent. `.lyr-title` and `.mh-scope` already hardcode #cfe0f5
// for exactly this reason, which is the convention this check now enforces.
const MAP_FACE_CLASSES = [
  ".layer-control", ".lyr-", ".mh-", ".map-coords", ".landsd-badge",
  ".maplibregl-ctrl", ".cam-popup", ".map-key",
];
// Selector substrings that are ALLOWED to use themed tokens even though they sit
// above the map, because they are THEMED CARDS rather than map-face drawing.
// `.cam-popup` is a white popup with dark text: `--panel-solid` background plus
// `--txt` foreground is exactly right there, in both themes. Exempting it here
// keeps the exemption reviewable instead of silencing the check globally.
const THEMED_CARD_SELECTORS = [".cam-popup .maplibregl-popup-content"];
// Tokens that flip between themes and therefore must not be used on the map face.
const THEMED_TOKENS = ["--txt", "--dim", "--faint", "--void", "--panel", "--panel-solid", "--shade"];
const themedProblems = [];
{
  const text = css["app.css"] ?? "";
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat(m.split(/\r?\n/).length - 1));
  const lines = stripped.split(/\r?\n/);
  let selector = "";
  lines.forEach((line, i) => {
    // Track the most recent selector so we know which block a declaration is in.
    const sel = line.match(/^([^{}]*)\{/);
    if (sel) selector = sel[1].trim();
    if (!MAP_FACE_CLASSES.some((c) => selector.includes(c))) return;
    if (THEMED_CARD_SELECTORS.some((c) => selector.includes(c))) return;
    for (const m of line.matchAll(/var\(\s*(--[a-z0-9-]+)\s*,?/gi)) {
      if (!THEMED_TOKENS.includes(m[1])) continue;
      // PROPERTY MATTERS. A themed token used as a BACKGROUND or BORDER is
      // correct — the element is then a themed card sitting above the map (the
      // camera popup is exactly this: white surface, dark text, `--panel-solid`
      // + `--txt` are right there). It is only wrong on a property whose colour
      // is drawn AGAINST the dark map: `color`, `fill`, `stroke`, and the
      // text-shadow/outline pair.
      const before = line.slice(0, m.index);
      const prop = (before.match(/([a-z-]+)\s*:\s*[^:;]*$/i) ?? [])[1] ?? "";
      if (!/^(color|fill|stroke|text-shadow|caret-color)$/i.test(prop)) continue;
      themedProblems.push({ file: "app.css", line: i + 1, token: m[1], selector, text: line.trim().slice(0, 92) });
    }
  });
}

if (themedProblems.length > 0) {
  console.error(`THEMED TOKEN USED ON THE MAP FACE: ${themedProblems.length}\n`);
  for (const p of themedProblems) {
    console.error(`  ${p.file}:${p.line}  ${p.token}   in  ${p.selector}`);
    console.error(`      ${p.text}`);
  }
  console.error(
    "\nThe map face is always dark. A themed token renders the LIGHT value there," +
      "\nwhich is near-black on a dark surface — invisible, and silent. Hardcode a" +
      "\nmap-face colour (the codebase uses #cfe0f5) or add a fallback.",
  );
  process.exit(1);
}

if (problems.length > 0) {
  console.error(`UNDEFINED CSS TOKENS: ${problems.length}\n`);
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}  ${p.token}`);
    console.error(`      ${p.text}`);
  }
  console.error(
    `\nDefined tokens (${defined.size}): ${[...defined].sort().join(" ")}`,
  );
  console.error(
    "\nFix the name, or give the var() an explicit fallback. An undefined token" +
      "\nis silently invalid — the property falls back to `inherit` and NO tool reports it.",
  );
  process.exit(1);
}
console.log(`CSS tokens OK: ${defined.size} defined, all ${files.length} stylesheets resolve every var()`);
