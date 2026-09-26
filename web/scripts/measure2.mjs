// measure2.mjs — typography + colour, targeted.
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "rev");
mkdirSync(out, { recursive: true });
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(10000);

const r = await page.evaluate(() => {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return p.length >= 3 ? [p[0], p[1], p[2], p.length > 3 ? p[3] : 1] : null;
  };
  // walk up for the first opaque background
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0.5) return c;
      n = n.parentElement;
    }
    const c = parse(getComputedStyle(document.body).backgroundColor);
    return c ?? [255, 255, 255, 1];
  };
  const contrast = (fg, bg) => {
    const a = lum(fg), b = lum(bg);
    const hi = Math.max(a, b), lo = Math.min(a, b);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10;
  };

  // group text elements by (font-size, class-ish bucket)
  const groups = {};
  const samples = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const rr = el.getBoundingClientRect();
    if (rr.width < 1 || rr.height < 1) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) continue;
    const fs = Math.round(parseFloat(cs.fontSize) * 10) / 10;
    const fg = parse(cs.color) ?? [255, 255, 255, 1];
    const bg = bgOf(el);
    const cr = contrast(fg, bg);
    const key = `${fs}px`;
    groups[key] ??= { n: 0, minContrast: 99, worst: null, classes: new Set() };
    const g = groups[key];
    g.n++;
    g.classes.add((el.className && typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : el.tagName.toLowerCase()) || el.tagName.toLowerCase());
    if (cr < g.minContrast) {
      g.minContrast = cr;
      g.worst = { text: el.textContent.trim().slice(0, 40), color: cs.color, bg: `rgb(${bg[0]},${bg[1]},${bg[2]})`, sel: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : "") };
    }
    if (samples.length < 400) samples.push({ fs, cr, text: el.textContent.trim().slice(0, 30) });
  }

  // key surfaces
  const surf = {};
  for (const sel of ["body", "header", "#rail", "#map", ".panel", ".panel-head", ".panel-body", "#statusbar", "#ticker", ".layer-control"]) {
    const el = document.querySelector(sel);
    if (!el) { surf[sel] = "MISSING"; continue; }
    const cs = getComputedStyle(el);
    const rr = el.getBoundingClientRect();
    surf[sel] = { bg: cs.backgroundColor, color: cs.color, fs: cs.fontSize, pad: cs.padding, rect: [Math.round(rr.x), Math.round(rr.y), Math.round(rr.width), Math.round(rr.height)] };
  }

  // empty space: find the biggest vertical gap inside the right column and left rail
  const gaps = [];
  const col = document.querySelector("#panels") || document.querySelector("aside") || document.querySelector("[class*=panel-col]");
  if (col) {
    const kids = [...col.querySelectorAll("section.panel")].map((e) => e.getBoundingClientRect()).sort((a, b) => a.top - b.top);
    const colR = col.getBoundingClientRect();
    const inner = { x: Math.round(colR.x), w: Math.round(colR.width) };
    for (let i = 0; i < kids.length; i++) {
      const a = kids[i].bottom, b = i + 1 < kids.length ? kids[i + 1].top : colR.bottom;
      if (b - a > 40) gaps.push({ after: i, gapPx: Math.round(b - a), y: Math.round(a) });
    }
    // how far the column content extends past the viewport
    const last = kids.length ? kids[kids.length - 1].bottom : colR.bottom;
    gaps.push({ note: "column content bottom", y: Math.round(last), viewportH: innerHeight, overflowPx: Math.round(last - innerHeight) });
  }
  return { groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, { n: v.n, minContrast: v.minContrast, worst: v.worst, topClasses: [...v.classes].slice(0, 6) }])), surf, gaps };
});

writeFileSync(join(out, "measure2.json"), JSON.stringify(r, null, 2));
console.log(JSON.stringify(r, null, 2));
await browser.close();
