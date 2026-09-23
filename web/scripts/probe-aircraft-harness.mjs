// probe-aircraft-harness.mjs — replicate the harness's exact sequence up to the
// aircraft test, then inspect. The layer works standalone (40 aircraft) but
// reports 0 inside the harness, so the difference is the preceding state.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "zh-HK" });
const net = [];
page.on("response", (r) => { if (r.url().includes("adsb")) net.push(`${r.status()} ${r.url().slice(0, 100)}`); });
page.on("console", (m) => { if (m.type() === "error") console.log(`[err] ${m.text().slice(0, 180)}`); });

await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(10000);

const railClick = async (label) => {
  const ok = await page.evaluate((needle) => {
    const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
      (x.querySelector(".tip")?.textContent ?? "").includes(needle));
    if (!b) return false;
    b.click();
    return true;
  }, label);
  if (!ok) throw new Error(`not found: ${label}`);
};

// Replicate: offline window (this is what the harness does before the layers).
await page.context().setOffline(true);
await page.waitForTimeout(1500);
await page.context().setOffline(false);
await page.waitForTimeout(4000);

// Now toggle imagery off (as the harness does), then aircraft on.
await railClick("航拍底圖");
await page.waitForTimeout(2500);
await railClick("航拍底圖");
await page.waitForTimeout(1200);

console.log("aircraft pressed BEFORE click:", await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
    (x.querySelector(".tip")?.textContent ?? "").includes("航機"));
  return b?.getAttribute("aria-pressed");
}));

await railClick("航機");
await page.waitForTimeout(2000);

console.log("aircraft pressed AFTER click:", await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
    (x.querySelector(".tip")?.textContent ?? "").includes("航機"));
  return b?.getAttribute("aria-pressed");
}));

for (let i = 0; i < 5; i++) {
  await page.waitForTimeout(4000);
  const s = await page.evaluate(() => {
    const m = window.__map;
    const has = m.getSource("vl-aircraft");
    return { src: !!has, dataFeats: has?._data?.features?.length ?? null, tileFeats: m.querySourceFeatures("vl-aircraft").length, layer: !!m.getLayer("vl-aircraft-point") };
  });
  console.log(`t=${(i + 1) * 4}s`, JSON.stringify(s));
}
console.log("adsb net:", net.length ? net.join("\n") : "(none)");
await browser.close();
