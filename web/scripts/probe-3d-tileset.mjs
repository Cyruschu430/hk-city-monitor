#!/usr/bin/env node
// probe-3d-tileset.mjs — toggle the 3D layer and report whether ANY Scenegraph-
// Layer init assertion appears (i.e. whether the current /config/3d tileset
// renders in this environment). The worker's TILES3D_BUILDING_URL var decides
// which tileset is on trial; swap it in wrangler.toml, restart wrangler, rerun.

import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 160));
});
page.on("requestfailed", (r) => { if (!r.url().includes("rad_256_png")) console.log("  [failed]", r.url().slice(0, 90)); });

await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.click(".rail-btn:nth-child(11)"); // buildings3d on
await page.waitForFunction(() => !!window.__overlay3d, null, { timeout: 40_000 }).catch(() => console.log("  (overlay never appeared)"));
await page.waitForTimeout(14_000);
const asserts = errors.filter((e) => e.includes("assertion failed") || e.includes("A 3D tile failed to load"));
const cfg = await page.evaluate(async () => {
  const r = await fetch("http://127.0.0.1:8787/config/3d");
  return r.ok ? (await r.json()).wgs84?.building : "config fetch failed";
});
console.log("tileset under test:", cfg);
console.log("deck assertion/Tile errors:", asserts.length ? asserts.join("\n  ") : "NONE");
console.log("other console errors:", errors.filter((e) => !asserts.includes(e)).slice(0, 3).join(" | ") || "NONE");
await browser.close();