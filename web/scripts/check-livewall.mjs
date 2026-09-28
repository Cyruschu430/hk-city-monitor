// check-livewall.mjs — the live wall's region tabs, exercised by clicking them.
//
// The numbers are the evidence: deep-review.mjs already screenshots the page, and a PNG
// would churn ~850KB in git on every run.
import { chromium } from "playwright-core";
const exe = process.env.CHROME_PATH ?? process.env.HKCM_CHROME
  ?? "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? "OK  " : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });
const errs = [], bad = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 160)); });
page.on("requestfailed", (r) => bad.push(r.url().slice(0, 120)));
page.on("response", (r) => { if (r.status() >= 400) bad.push(`HTTP ${r.status()} ${r.url().slice(0, 110)}`); });

await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
try { await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 }); } catch {}
await page.waitForTimeout(18000);

const read = () => page.evaluate(() => {
  const p = document.querySelector('[data-panel="live_wall"]');
  if (!p) return { found: false };
  return {
    found: true,
    title: p.querySelector(".panel-head h2")?.textContent?.slice(0, 24) ?? "",
    tabs: [...p.querySelectorAll(".walltabs .ptab")].map((b) => b.textContent.replace(/\s+/g, " ").trim()),
    active: p.querySelector('.walltabs .ptab[aria-selected="true"]')?.getAttribute("data-region"),
    tiles: p.querySelectorAll(".wall .cam").length,
    liveTiles: p.querySelectorAll(".wall .cam.live").length,
    labels: [...p.querySelectorAll(".wall .lab")].map((l) => l.textContent.split(" · ")[0].slice(0, 20)),
  };
});

const r = { initial: await read() };

// Click each region tab in turn and record what the wall becomes. Without this the test
// would only prove the strip renders, not that picking a region does anything.
const regions = await page.evaluate(() =>
  [...document.querySelectorAll('[data-panel="live_wall"] .walltabs .ptab')].map((b) => b.getAttribute("data-region")),
);
r.byRegion = {};
for (const key of regions) {
  if (key === "") continue;
  await page.click(`[data-panel="live_wall"] .walltabs .ptab[data-region="${key}"]`);
  await page.waitForTimeout(2600);
  r.byRegion[key] = await read();
}
await page.click('[data-panel="live_wall"] .walltabs .ptab[data-region=""]');
await page.waitForTimeout(2600);
r.backToAll = await read();

r.mainTabs = await page.evaluate(() =>
  [...document.querySelectorAll(".ptab")].filter((b) => !b.closest(".walltabs")).map((b) => b.textContent.replace(/\s+/g, " ").trim()),
);
r.panelCount = await page.evaluate(() => document.querySelectorAll("[data-panel]").length);
console.log(JSON.stringify(r, null, 1));
console.log("\nconsole errors:", errs.length ? [...new Set(errs)].slice(0, 4) : "0");
console.log("failed/4xx:", [...new Set(bad)].slice(0, 6));

// ── the INLINE PLAYER ───────────────────────────────────────────────────────────────
// A confirmed-live tile plays in the panel, several at once, and a second click stops it.
// The drawer stays reserved for cameras and off-air channels, so its state is part of the
// assertion: a player that opened a popup instead would pass a frame count on its own.
const LIVE = '[data-panel="live_wall"] .wall .cam:has(.chip.live)';
const playState = () =>
  page.evaluate(() => {
    const p = document.querySelector('[data-panel="live_wall"]');
    const drawer = document.getElementById("drawer");
    return {
      playing: p.querySelectorAll(".wall .cam.playing").length,
      frames: p.querySelectorAll(".wall .cam iframe").length,
      drawerOpen: drawer ? !drawer.hidden : false,
    };
  });

const liveCount = await page.locator(LIVE).count();
ok(liveCount > 0, `at least one tile is confirmed live to click (${liveCount})`);
if (liveCount > 0) {
  await page.locator(LIVE).nth(0).click();
  await page.waitForTimeout(1800);
  const one = await playState();
  ok(one.frames === 1, `clicking a live tile mounts exactly one player inside the panel (${one.frames})`);
  ok(!one.drawerOpen, "the player is in the PANEL — no drawer was opened");

  if (liveCount > 1) {
    await page.locator(LIVE).nth(1).click();
    await page.waitForTimeout(1800);
    const two = await playState();
    ok(two.frames === 2, `two tiles play at once (${two.frames} players)`);
    // Stop by the BADGE, not the tile: once playing, the frame covers the tile and a
    // click in the middle belongs to YouTube's controls. The badge is the affordance,
    // and it has to be reachable above the frame or a started tile cannot be stopped.
    await page.locator(LIVE).nth(1).locator(".chip.live").click();
    await page.waitForTimeout(800);
    ok((await playState()).frames === 1, "the badge stops the stream it belongs to");
  }
  await page.locator(LIVE).nth(0).locator(".chip.live").click();
  await page.waitForTimeout(800);
  const off = await playState();
  ok(off.frames === 0 && off.playing === 0, `clicking the badge stops the player (${off.frames} left)`);
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nLIVE WALL OK");
process.exit(fails.length ? 1 : 0);
