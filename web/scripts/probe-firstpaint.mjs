// probe-firstpaint.mjs — how many panels mount on a FRESH load, over time?
//
// MEASURED 2026-09-24: audit-production.mjs clicks through every category tab
// and every mode before it counts panels, so it always reports ~18. A fresh
// load with no interaction reported ONE panel (water_suspension_list). That
// gap is the whole finding: the audit was measuring the post-interaction
// steady state and calling it the first paint. This probe measures the actual
// cold-boot curve, so "how long until the app is usable" becomes a number.
import { chromium } from "playwright-core";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:4173/";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });

await page.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
const t0 = Date.now();
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
console.log(`ready=1 after ${Date.now() - t0}ms`);

const probe = () =>
  page.evaluate(() => {
    const panels = [...document.querySelectorAll(".panel[data-panel]")];
    const byState = {};
    for (const p of panels) byState[p.dataset.state] = (byState[p.dataset.state] ?? 0) + 1;
    return {
      mounted: panels.length,
      byState,
      ids: panels.map((p) => p.dataset.panel),
      activeTab: window.__hkcm?.currentTab?.() ?? null,
      tabButtons: [...document.querySelectorAll("#panelTabs .ptab")].map(
        (b) => `${b.dataset.group}:${b.getAttribute("aria-selected") ?? b.className}`,
      ),
    };
  });

console.log(`\n${"t(s)".padStart(6)}  mounted  states`);
let last = -1;
for (const wait of [0, 1000, 2000, 3000, 5000, 8000, 12000, 16000, 20000, 30000, 45000]) {
  const target = wait;
  const elapsed = Date.now() - t0;
  if (target > elapsed) await page.waitForTimeout(target - elapsed);
  const s = await probe();
  const stamp = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${stamp.padStart(6)}  ${String(s.mounted).padStart(7)}  ${JSON.stringify(s.byState)}`);
  if (s.mounted !== last) {
    console.log(`        ids: ${s.ids.join(", ")}`);
    last = s.mounted;
  }
}

const final = await probe();
console.log(`\nactiveTab=${JSON.stringify(final.activeTab)}`);
console.log(`tab buttons: ${final.tabButtons.join("  ")}`);

await browser.close();
