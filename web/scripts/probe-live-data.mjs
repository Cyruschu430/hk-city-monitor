// probe-live-data.mjs — does the app actually read the live files, and does it survive
// when it cannot? Both halves matter: the live branch is what makes a reading minutes
// old instead of days old, and the committed snapshot is what keeps a working panel
// working when raw.githubusercontent is unreachable.
//
//   node scripts/probe-live-data.mjs [baseUrl]        # live path
//   BLOCK_LIVE=1 node scripts/probe-live-data.mjs     # fallback path
//
// MEASURED 2026-09-28 against the VPS build: 3 live files fetched 200, aircraft panel
// 16 aircraft at the publisher's own timestamp, berth layer 120 polygons, and with
// raw.githubusercontent aborted the aircraft panel still renders from the bundle.
import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? (process.env.HKCM_URL ?? process.env.BASE ?? "http://localhost:4173/");
const BLOCK = process.env.BLOCK_LIVE === "1";
const exe = process.env.CHROME_PATH ?? process.env.HKCM_CHROME
  ?? "C:\\Users\\<user>\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? "OK  " : "FAIL"} ${msg}`); if (!cond) fails.push(msg); };

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });

const live = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("raw.githubusercontent.com")) live.push(`${r.status()} ${u.split("/live-data/")[1]}`);
});
if (BLOCK) await page.route("**raw.githubusercontent.com**", (r) => r.abort());

const panel = (id) =>
  page.evaluate((pid) => {
    const p = document.querySelector(`[data-panel="${pid}"]`);
    return p ? { state: p.dataset.state, text: p.innerText.replace(/\s*\n\s*/g, " ").slice(0, 160) } : null;
  }, id);

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(12_000);

const aircraft = await panel("aircraft_status");
ok(aircraft !== null, "aircraft_status panel is mounted in 總覽");
ok(aircraft?.state !== "error", `aircraft panel is not in its error state (state=${aircraft?.state})`);
ok(/[0-9]/.test(aircraft?.text ?? ""), "the aircraft panel renders counts, not an empty box");

if (BLOCK) {
  ok(live.length === 0, `no live requests were attempted (${live.length})`);
  ok(aircraft?.state !== "error", "BLOCKED live branch → the panel still renders from the committed snapshot");
} else {
  const got = new Set(live.map((l) => l.split(" ")[1]));
  ok(live.every((l) => l.startsWith("200")), `every live request answered 200: ${[...new Set(live)].join(", ") || "(none)"}`);
  ok(got.has("aircraft.json"), "aircraft.json came from the live-data branch");
  ok(got.has("water_suspension.json"), "water_suspension.json came from the live-data branch");

  // The berth layer is the third live file, and it is a LAYER, so it only loads in 貨運模式.
  await page.evaluate(() => [...document.querySelectorAll(".rail-btn")].find((b) => b.textContent.includes("貨運"))?.click());
  await page.waitForTimeout(6_000);
  const berth = await page.evaluate(() => {
    const f = window.__map?.getSource("vl-berth_vacancy")?._data?.features ?? [];
    return { n: f.length, last: f[0]?.properties?.LastUpdate ?? null };
  });
  ok(berth.n > 0, `berth layer carries live polygons (${berth.n})`);
  ok(!!berth.last, `each berth carries its own LastUpdate (${berth.last})`);
}

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nLIVE DATA OK");
process.exit(fails.length ? 1 : 0);
