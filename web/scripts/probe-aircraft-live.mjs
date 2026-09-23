// probe-aircraft-live.mjs — the harness reports 0 aircraft while the endpoint
// returns 41. Find out where it breaks, with the network visible.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, locale: "zh-HK" });

const net = [];
page.on("response", (r) => {
  if (r.url().includes("adsb")) net.push(`${r.status()} ${r.url().slice(0, 120)}`);
});
page.on("console", (m) => console.log(`[${m.type()}] ${m.text().slice(0, 200)}`));
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message.slice(0, 200)}`));

await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(12000);

console.log("--- adsb network during boot ---");
console.log(net.length ? net.join("\n") : "(none)");

const panel = await page.evaluate(() => {
  const p = document.querySelector('.panel[data-panel="aircraft_status"]');
  return { present: !!p, state: p?.dataset.state, text: p?.querySelector(".panel-body")?.textContent?.trim() };
});
console.log("aircraft panel:", JSON.stringify(panel));

await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
    (x.querySelector(".tip")?.textContent ?? "").includes("航機"));
  b?.click();
});

// Poll for up to 40s so we can see WHEN it appears (or never does).
for (const t of [3000, 6000, 10000, 15000, 25000, 40000]) {
  await page.waitForTimeout(t === 3000 ? 3000 : 3000);
  const s = await page.evaluate(() => {
    const m = window.__map;
    const has = m.getSource("vl-aircraft");
    return {
      src: !!has,
      dataFeats: has?._data?.features?.length ?? null,
      tileFeats: m.querySourceFeatures("vl-aircraft").length,
      layer: !!m.getLayer("vl-aircraft-point"),
    };
  });
  console.log(`t≈${t}ms`, JSON.stringify(s));
}
console.log("--- adsb network after toggle ---");
console.log(net.length ? net.join("\n") : "(none)");
await browser.close();
