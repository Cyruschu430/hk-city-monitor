// probe-analysis2.mjs — the analysis panel never rendered. Find out where the
// pipeline stops: rules loaded? state populated? brief produced?
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
page.on("console", (m) => console.log(`[${m.type()}] ${m.text().slice(0, 180)}`));
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message.slice(0, 240)}`));
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(14_000);

const diag = await page.evaluate(() => {
  const hk = window.__hkcm;
  return {
    hasHkcm: !!hk,
    registryKeys: hk?.registry ? Object.keys(hk.registry) : null,
    rulesCount: hk?.registry?.rules?.length ?? "no rules key",
    // What has the panel engine actually published?
    stateKeys: hk?.triggerState ? Object.keys(hk.triggerState) : null,
    triggerState: hk?.triggerState
      ? Object.fromEntries(Object.entries(hk.triggerState).map(([k, v]) => [k, typeof v === "object" && v ? Object.keys(v).slice(0, 6) : typeof v]))
      : null,
  };
});
console.log(JSON.stringify(diag, null, 1));
await browser.close();
