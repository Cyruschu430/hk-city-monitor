// probe-carpark.mjs — is the 停車場空位 panel actually showing what it claims?
//
// Hypothesis (from reading parsers.ts, NOT yet measured): `parseCarpark` reads
// `base.capacity` from `basic_info_all.json`, but that feed's own key list is
// park_id/name/address/lat/lng/district/contactNo/opening_status/height/remark/
// website/photo — there is NO `capacity`. If so then every row's capacity is 0,
// which means (a) the 總數 column renders "—" for every row, and (b) the sort key
// `vacancy / capacity` is Infinity for every row, so `br - ar` is NaN and the
// "top 12 by free ratio" has never ordered anything — the panel shows the first
// 12 in feed order.
//
// Both are invisible: a table of 12 rows with plausible numbers looks fine.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const url = process.argv[2] ?? "http://localhost:4173/";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
// The carpark panel is an OVERVIEW panel, and the app legitimately hoists 停水模式
// when drinking water is out — which hides it. Go to 總覽 explicitly, or a probe
// run during a real outage reports "no panel" and looks like a regression.
await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
    (x.querySelector(".tip")?.textContent ?? "").includes("總覽"),
  );
  b?.click();
});
await page.waitForTimeout(3000);
// Wait on the panel's own settled state, not a timer (Pitfall 19).
await page
  .waitForFunction(
    () => {
      const p = document.querySelector('.panel[data-panel="carpark_vacancy_list"]');
      return p && p.dataset.state !== "loading";
    },
    null,
    { timeout: 60_000 },
  )
  .catch(() => {});
await page.waitForTimeout(2500);

const out = await page.evaluate(() => {
  const p = document.querySelector('.panel[data-panel="carpark_vacancy_list"]');
  if (!p) return { err: "no panel" };
  const heads = [...p.querySelectorAll("th")].map((t) => t.textContent?.trim());
  const rows = [...p.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent?.trim() ?? ""),
  );
  return {
    state: p.dataset.state,
    updated: p.querySelector(".panel-updated")?.textContent?.trim() ?? null,
    heads,
    rowCount: rows.length,
    rows: rows.slice(0, 14),
    // The two symptoms, measured rather than inferred.
    dashTotalCells: rows.filter((r) => r[2] === "—").length,
  };
});
console.log(JSON.stringify(out, null, 1));

// Is the panel's order the feed's order? Compare against the raw source order.
const feed = await page.evaluate(async () => {
  const r = await fetch("https://resource.data.one.gov.hk/td/carpark/vacancy_all.json", { cache: "no-store" });
  const j = await r.json();
  return j.car_park.slice(0, 14).map((c) => c.park_id);
});
console.log("feed order (first 14 park_ids):", JSON.stringify(feed));

await browser.close();
