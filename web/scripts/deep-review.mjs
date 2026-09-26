// deep-review.mjs — measure, don't eyeball.
//
// Vision passes on this project have already described UI that did not exist. So this dumps raw
// numbers: geometry, computed styles, overlaps, contrast, console errors, failed requests. The
// screenshot is for context; the JSON is the evidence.
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

const consoleErrors = [];
const failedRequests = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") consoleErrors.push(`${m.type()}: ${m.text()}`.slice(0, 300));
});
page.on("requestfailed", (r) => failedRequests.push(`${r.url().slice(0, 160)} — ${r.failure()?.errorText}`));
page.on("response", (r) => {
  if (r.status() >= 400) failedRequests.push(`HTTP ${r.status()} ${r.url().slice(0, 160)}`);
});

const t0 = Date.now();
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
let ready = false;
try {
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 });
  ready = true;
} catch {}
const bootMs = Date.now() - t0;
await page.waitForTimeout(12000); // let live fetches settle

const report = await page.evaluate(() => {
  const vis = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== "none" && cs.visibility !== "hidden" && parseFloat(cs.opacity) > 0.02 && r.width > 0 && r.height > 0;
  };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const sel = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "");

  // ── everywhere-in-the-dom text size census
  const textSizes = {};
  let tinyCount = 0;
  const tinySamples = [];
  for (const el of document.querySelectorAll("body *")) {
    if (!vis(el)) continue;
    const hasDirectText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!hasDirectText) continue;
    const fs = Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10;
    textSizes[fs] = (textSizes[fs] ?? 0) + 1;
    if (fs < 11) {
      tinyCount++;
      if (tinySamples.length < 12) tinySamples.push({ sel: sel(el), fs, text: el.textContent.trim().slice(0, 45), ...rect(el) });
    }
  }

  // ── fixed/absolute overlay geometry, for overlap detection
  const overlays = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" && cs.position !== "absolute") continue;
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 30) continue;          // ignore icons/dots
    if (el.closest("[data-review-ignore]")) continue;
    overlays.push({ sel: sel(el), pos: cs.position, z: cs.zIndex, ...rect(el), text: el.textContent.trim().slice(0, 60) });
  }
  // pairwise overlap of the big ones
  const big = overlays.filter((o) => o.w * o.h > 12000);
  const overlaps = [];
  for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) {
    const a = big[i], b = big[j];
    if (a.sel === b.sel) continue;
    const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    if (ox * oy > 3000) overlaps.push({ a: a.sel, b: b.sel, px: ox * oy, area: `${ox}x${oy}` });
  }
  overlaps.sort((p, q) => q.px - p.px);

  // ── canvas / webgl
  const canvases = [...document.querySelectorAll("canvas")].map((c) => {
    let gl = "n/a";
    try { gl = c.getContext("webgl2") ? "webgl2" : c.getContext("webgl") ? "webgl" : "none"; } catch (e) { gl = "err"; }
    return { ...rect(c), gl, cssW: c.width, cssH: c.height };
  });

  // ── panels: what does the app claim to be showing
  const panels = [];
  for (const el of document.querySelectorAll("[data-panel], .panel, [class*=panel]")) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 30) continue;
    panels.push({
      sel: sel(el),
      state: el.dataset.state ?? el.getAttribute("data-state") ?? null,
      id: el.dataset.panelId ?? el.id ?? null,
      ...rect(el),
      text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 90),
    });
  }

  const map = window.__map;
  const layerIds = map ? map.getStyle().layers.map((l) => l.id) : [];

  return {
    title: document.title,
    lang: document.documentElement.lang,
    viewport: { w: innerWidth, h: innerHeight },
    bodyScroll: { w: document.body.scrollWidth, h: document.body.scrollHeight },
    docScroll: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
    textSizes, tinyCount, tinySamples,
    overlayCount: overlays.length,
    overlays: overlays.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 22),
    overlaps: overlaps.slice(0, 12),
    canvases,
    panels: panels.slice(0, 40),
    layerCount: layerIds.length,
    layerIds: layerIds.slice(0, 60),
    mapExposed: !!map,
    hasReadyFlag: document.body.dataset.ready === "1",
  };
});

// how many panels are in each honesty state, at the app's own API
const honesty = await page.evaluate(() => {
  const c = {};
  for (const el of document.querySelectorAll("[data-state]")) {
    const s = el.dataset.state;
    c[s] = (c[s] ?? 0) + 1;
  }
  return c;
});

await page.screenshot({ path: join(out, "review-1920.png") });
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(2500);
await page.screenshot({ path: join(out, "review-1440.png") });

report.bootMs = bootMs;
report.ready = ready;
report.honestyStates = honesty;
report.consoleErrors = consoleErrors.slice(0, 25);
report.failedRequests = failedRequests.slice(0, 30);

writeFileSync(join(out, "review.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
