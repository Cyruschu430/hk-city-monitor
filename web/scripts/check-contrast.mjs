// check-contrast.mjs — the guard that the class-name list could not be.
//
// WHY THIS EXISTS
// check-tokens.mjs catches a themed token used as `color` inside a hardcoded list of map-face
// class names. That list cannot be complete: the ticker (#ticker/.tk-title) has a hardcoded dark
// background but was never added to it, so in light theme it renders --txt (#0b1626, near-black)
// on rgba(10,16,26,.92). Measured contrast: 1.0. The entire news ticker was invisible, and
// nothing reported it — not tsc, not the build, not check-tokens, not the console.
//
// The class list is the wrong instrument. Two directions break it and only one is covered:
//   1. a THEMED token drawn on a hardcoded-dark surface  (ticker: --txt on near-black)
//   2. a MAP-FACE token drawn on a themed surface        (.mh-scope: #cfe0f5 on light body)
// Both are invisible text. Both are silent. Contrast is measurable, so measure it: render the
// page in each theme, walk every visible text node, compute the real ratio against its first
// opaque ancestor background, and fail under 4.5:1.
//
// Run against a served build. Exit 1 with a ranked list, or 0 with a count.
import { chromium } from "playwright-core";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.HKCM_URL ?? (process.env.HKCM_URL ?? process.env.BASE ?? "http://localhost:4173/");
const MIN = Number(process.env.MIN_CONTRAST ?? 4.5);
const exe = process.env.HKCM_CHROME ?? "C:\\Users\\<user>\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });

const audit = async (theme) => {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
    document.documentElement.style.colorScheme = t;
  }, theme);
  await page.waitForTimeout(1200);
  return page.evaluate((MINC) => {
    const srgb = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const lum = (c) => 0.2126 * srgb(c[0]) + 0.7152 * srgb(c[1]) + 0.0722 * srgb(c[2]);
    const parse = (s) => {
      const m = String(s).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return p.length >= 3 ? [p[0], p[1], p[2], p.length > 3 ? p[3] : 1] : null;
    };
    // Is the thing behind this text a CANVAS or an IMG? CSS backgrounds cannot see those pixels,
    // so the ratio computed against the container's CSS background is a FALSE POSITIVE. The map
    // header and the scale bar sit over the map canvas; camera chips sit over thumbnails. Report
    // those as UNKNOWN rather than failing them (and never "fix" them by switching to themed ink,
    // which would break them for real in the other theme).
    const paintedBeneath = (el) => {
      const r = el.getBoundingClientRect();
      const covers = (b) => b.width > 20 && b.height > 20 &&
        b.left <= r.left + 4 && b.right >= r.right - 4 && b.top <= r.top + 4 && b.bottom >= r.bottom - 4;
      let n = el.parentElement;
      while (n && n !== document.documentElement) {
        for (const c of n.querySelectorAll(":scope > canvas, :scope > img, :scope > video, :scope > picture")) {
          if (!el.contains(c) && covers(c.getBoundingClientRect())) return c.tagName.toLowerCase();
        }
        // The map canvas is a SIBLING of #mapHud, not an ancestor of it, so an ancestor-only walk
        // never sees it — which is why the map header kept reporting 1.2:1 against the page
        // background while actually sitting on dark tiles. Check sibling subtrees too.
        for (const sib of n.children) {
          if (sib === el || sib.contains(el)) continue;
          for (const c of sib.querySelectorAll("canvas, img, video, picture")) {
            if (covers(c.getBoundingClientRect())) return c.tagName.toLowerCase();
          }
        }
        n = n.parentElement;
      }
      return null;
    };
    // first ancestor (or self) with a background opaque enough to matter
    const bgOf = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c[3] >= 0.5) return c;
        n = n.parentElement;
      }
      return parse(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1];
    };
    const ratio = (f, b) => {
      const a = lum(f), c = lum(b);
      return Math.round(((Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05)) * 100) / 100;
    };
    // NOT restricted to the viewport. Most panels sit below the fold and were being skipped,
    // which is how a 40-node audit missed 90% of the page. Computed styles are valid off-screen.
    const vis = (el, cs, r) =>
      cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0.05 &&
      r.width > 1 && r.height > 1 && el.offsetParent !== null;
    const label = (el) => {
      const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
      return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + cls;
    };

    const bad = [];
    const unknown = [];
    let checked = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (!vis(el, cs, r)) continue;
      const fg = parse(cs.color);
      if (!fg || fg[3] < 0.05) continue;              // fully transparent text is intentional
      const fs = Math.round(parseFloat(cs.fontSize) * 10) / 10;
      const bold = Number(cs.fontWeight) >= 700;
      // WCAG: large text (>=18.66px bold, or >=24px) may sit at 3:1
      const need = fs >= 24 || (fs >= 18.66 && bold) ? Math.max(3, MINC - 1.5) : MINC;
      const under = paintedBeneath(el);
      if (under) { unknown.push({ sel: label(el), fs, text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 44), over: under }); continue; }
      const bg = bgOf(el);
      const cr = ratio(fg, bg);
      checked++;
      if (cr < need) {
        bad.push({
          sel: label(el), fs, cr, need,
          fg: `rgb(${fg.slice(0, 3).map(Math.round).join(",")})`,
          bg: `rgb(${bg.slice(0, 3).map(Math.round).join(",")})`,
          text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 52),
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        });
      }
    }
    return { checked, bad, unknown };
  }, MIN);
};

const runFor = async (theme) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // Fatal, not swallowed: an app that never boots yields zero low-contrast nodes, and "0 failures"
  // then reads as a pass. Same false-pass that check-layout.mjs had.
  //
  // Fatal, but with ONE retry: a cold browser backend loses the first navigation, which is a flake
  // rather than a result. Single-shot fatal turns it into a red check on a healthy build — measured
  // 2026-09-27, check:all exit=1. Two failures is still a result, so the guard stays fatal.
  let booted = false;
  for (let attempt = 1; attempt <= 2 && !booted; attempt++) {
    try {
      await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 });
      booted = true;
      if (attempt > 1) console.log(`(booted on retry - the first navigation was a cold-start miss)`);
    } catch {
      if (attempt === 1) await page.goto(BASE, { waitUntil: "domcontentloaded" });
    }
  }
  if (!booted) {
    console.error("readiness timeout on both attempts: document.body.dataset.ready never became 1 - the app failed to boot.");
    await browser.close();
    process.exit(1);
  }
  await page.waitForTimeout(9000);
  return audit(theme);
};

const results = {};
for (const t of ["dark", "light"]) results[t] = await runFor(t);
await browser.close();

let total = 0;
let unknownTotal = 0;
for (const [theme, res] of Object.entries(results)) {
  total += res.bad.length;
  unknownTotal += res.unknown.length;
  console.log(`\n── ${theme} theme — checked ${res.checked} text nodes, ${res.bad.length} below ${MIN}:1` +
    (res.unknown.length ? `  ·  ${res.unknown.length} skipped over canvas/img (unknown backdrop)` : ""));
  // rank worst first, and collapse repeats of the same selector into one line with a count
  const bySel = new Map();
  for (const b of res.bad) {
    const k = b.sel;
    if (!bySel.has(k)) bySel.set(k, { ...b, n: 1 });
    else { const e = bySel.get(k); e.n++; if (b.cr < e.cr) Object.assign(e, b, { n: e.n }); }
  }
  const ranked = [...bySel.values()].sort((a, b) => a.cr - b.cr);
  for (const b of ranked.slice(0, 30)) {
    console.log(`  ${String(b.cr).padStart(5)}:1 (need ${b.need})  ${String(b.fs + "px").padEnd(7)} ${b.fg} on ${b.bg}  ×${b.n}`);
    console.log(`      ${b.sel}  «${b.text}»`);
  }
  if (ranked.length > 30) console.log(`  … and ${ranked.length - 30} more distinct selectors`);
}

console.log(`\n${total === 0 ? "CONTRAST OK" : `CONTRAST FAILURES: ${total}`}  (${unknownTotal} nodes over canvas/img not judgeable from CSS — see above)`);
// A page that rendered nothing has nothing to fail. Require evidence that there was something
// to audit before accepting a clean result.
const MIN_NODES = 200;
const audited = Math.min(...Object.values(results).map((r) => r.checked));
if (audited < MIN_NODES) {
  console.error(`only ${audited} text nodes were audited (expected at least ${MIN_NODES}) - the app likely did not render`);
  process.exit(1);
}
process.exit(total === 0 ? 0 : 1);
