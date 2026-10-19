// probe-toggles.mjs — the claim "clicking a row enables a layer" is only true if the row's
// aria-checked starts false. The beach row drew nothing while its neighbours drew, so this prints
// every row's state around the click and whether a source appears.
import { chromium } from "playwright-core";
import { browserExe } from "./browser.mjs";

const base = process.argv[2] ?? "http://127.0.0.1:8921";
const ids = ["ai_cctv_speed", "mtr_bus_stops", "lcsd_facilities", "beach_grading", "carpark_vacancy"];
const browser = await chromium.launch({
  executablePath: browserExe(),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });
page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 160)));
// The layer toggle reports failure with console.warn and a banner, not with an error — listening
// only for errors is why the first three probes came back silent.
page.on("console", (m) => {
  if (/hkcm|layer|圖層/i.test(m.text())) console.log(`console.${m.type()}:`, m.text().slice(0, 200));
});
await page.goto(base, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => !!window.__map, null, { timeout: 90000 });
await page.waitForTimeout(4000);

for (const id of ids) {
  const before = await page.evaluate((r) => {
    const btn = document.querySelector(`.lyr-item[data-row="${r}"] .lyr-row`);
    return btn ? { checked: btn.getAttribute("aria-checked"), cls: btn.className } : "no row";
  }, id);
  const click = await page.evaluate((r) => {
    const btn = document.querySelector(`.lyr-item[data-row="${r}"] .lyr-row`);
    if (!btn) return "no row";
    btn.click();
    return btn.getAttribute("aria-checked");
  }, id);
  // Wait for the source to APPEAR rather than for a fixed delay: the layer build includes a
  // network fetch, so a 6s window reported false failures on layers that were merely slow
  // (lcsd_facilities, which uses no proxy at all, "failed" in one run and passed in the next).
  await page
    .waitForFunction((r) => !!window.__map.getSource(`vl-${r}`), id, { timeout: 25000 })
    .catch(() => {});
  const after = await page.evaluate((r) => ({
    checked: document.querySelector(`.lyr-item[data-row="${r}"] .lyr-row`)?.getAttribute("aria-checked"),
    source: !!window.__map.getSource(`vl-${r}`),
    feats: window.__map.getSource(`vl-${r}`)?._data?.features?.length ?? 0,
  }), id);
  const banner = await page.evaluate(() => document.querySelector(".banner")?.textContent?.slice(0, 90) ?? "");
  console.log(id, "| before:", JSON.stringify(before), "| after click aria-checked:", click, "|", JSON.stringify(after), "| banner:", banner);
}
await browser.close();
