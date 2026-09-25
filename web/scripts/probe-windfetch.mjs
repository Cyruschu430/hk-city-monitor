// probe-windfetch.mjs — does the wind grid actually arrive in a BROWSER?
//
// Exists because a Python probe through the same Worker got `403 error code: 1010`
// for the wind URL AND for a control source that certainly works — 1010 is
// Cloudflare blocking the probe's own User-Agent, not the Worker's whitelist. A
// probe that cannot tell "the product is broken" from "I am blocked" is worse than
// no probe, so this one drives the real page and reads the real request.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const url = process.argv[2] ?? "http://localhost:4173/";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "zh-HK" });

const windCalls = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("open-meteo") || u.includes("wind")) {
    windCalls.push({ status: r.status(), url: u.slice(0, 150), cache: r.headers()["cf-cache-status"] ?? null });
  }
});
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
});

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(3000);

await page.evaluate(() => {
  [...document.querySelectorAll("#rail .rail-btn")]
    .find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("風場"))?.click();
});
try {
  await page.waitForFunction(() => Boolean(window.__windField), null, { timeout: 60_000 });
} catch {
  /* reported below */
}
await page.waitForTimeout(1000);

console.log("__windField :", JSON.stringify(await page.evaluate(() => window.__windField ?? null)));
console.log("requests    :", JSON.stringify(windCalls, null, 1));
console.log("console errs:", JSON.stringify(consoleErrors, null, 1));
console.log(
  "rail state  :",
  JSON.stringify(
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
        (x.querySelector(".tip")?.textContent ?? "").includes("風場"));
      return { pressed: b?.getAttribute("aria-pressed"), cls: b?.className };
    }),
  ),
);

await browser.close();
