// probe-trigger-boot.mjs — what does the trigger engine decide at boot?
// The dashboard collapses from 18 panels to 1 about 2s after load. The only
// code path that can replace the panel set after boot is evaluateTriggers ->
// activateMode, so dump the trigger state AND which vertical it resolves to.
import { chromium } from "playwright-core";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:4173/";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await page.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });

const read = () =>
  page.evaluate(() => ({
    mode: window.__hkcm?.currentMode?.() ?? null,
    mounted: document.querySelectorAll(".panel[data-panel]").length,
    ids: [...document.querySelectorAll(".panel[data-panel]")].map((p) => p.dataset.panel),
    triggerState: window.__hkcm?.triggerState ?? null,
    banner: document.querySelector(".banner")?.textContent?.trim().slice(0, 120) ?? null,
    statusMode: document.querySelector(".statusbar .mode")?.textContent?.trim() ?? null,
  }));

for (const t of [800, 1500, 2500, 4000, 8000]) {
  await page.waitForTimeout(t === 800 ? 800 : t - (t === 1500 ? 800 : t === 2500 ? 1500 : t === 4000 ? 2500 : 4000));
  const s = await read();
  console.log(`\n--- t≈${t}ms ---`);
  console.log(`mode=${JSON.stringify(s.mode)}  mounted=${s.mounted}  status="${s.statusMode}"`);
  console.log(`banner=${JSON.stringify(s.banner)}`);
  console.log(`ids: ${s.ids.join(", ")}`);
  console.log(`triggerState: ${JSON.stringify(s.triggerState)}`);
}

await browser.close();
