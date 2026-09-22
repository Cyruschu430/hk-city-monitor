// probe-aircraft3.mjs — capture the ACTUAL failure. The layer draws sometimes
// and not others, so log the network + console + the source state over time
// instead of sampling once.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });

const net = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("adsb")) net.push(`${r.status()} ${u.slice(0, 110)}`);
});
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || t.includes("hkcm")) console.log(`[console.${m.type()}] ${t.slice(0, 200)}`);
});
page.on("requestfailed", (r) => {
  if (r.url().includes("adsb")) console.log(`[reqfail] ${r.url().slice(0, 110)} — ${r.failure()?.errorText}`);
});

await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(12_000);

console.log("--- adsb network so far ---");
console.log(net.length ? net.join("\n") : "(none)");

console.log("--- toggling aircraft ---");
// The layer buttons carry their label in a `.tip` SPAN, not a title attribute.
// The first version of this probe searched `title` and matched nothing, then
// reported "toggled: true" from an unrelated button — a false positive that
// made the layer look broken when the probe was.
const which = await page.evaluate(() => {
  const btns = [...document.querySelectorAll("#rail .rail-btn")];
  const info = btns.map((b) => ({ tip: b.querySelector(".tip")?.textContent ?? "", pressed: b.getAttribute("aria-pressed") }));
  const b = btns.find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("航機"));
  if (!b) return { clicked: false, buttons: info };
  b.click();
  return { clicked: true, tip: b.querySelector(".tip")?.textContent, pressedAfter: b.getAttribute("aria-pressed"), buttons: info };
});
console.log(JSON.stringify(which, null, 1));

for (const t of [2000, 4000, 8000, 14000]) {
  await page.waitForTimeout(t === 2000 ? 2000 : t - (t === 4000 ? 2000 : t === 8000 ? 4000 : 8000));
  const s = await page.evaluate(() => {
    const m = window.__map;
    const has = m.getSource("vl-aircraft");
    return {
      srcExists: !!has,
      // _data is the GeoJSON handed to the source; read feature count off it.
      dataFeatures: has && has._data ? (has._data.features?.length ?? "n/a") : "no-data",
      tileFeatures: m.querySourceFeatures("vl-aircraft").length,
      layer: !!m.getLayer("vl-aircraft-point"),
    };
  });
  console.log(`t=${t}ms`, JSON.stringify(s));
}

console.log("--- adsb network after ---");
console.log(net.length ? net.join("\n") : "(none)");
await browser.close();
