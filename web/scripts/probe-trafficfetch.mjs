import { chromium } from "playwright-core";
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/chromium-browser",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
const reqs = [];
page.on("request", (r) => { if (/specialtrafficnews|resource\.data\.one\.gov\.hk/.test(r.url())) reqs.push("REQ " + r.url().slice(0, 120)); });
page.on("requestfinished", (r) => { if (/specialtrafficnews/.test(r.url())) reqs.push("DONE " + r.url().slice(0, 120)); });
page.on("requestfailed", (r) => { if (/specialtrafficnews/.test(r.url())) reqs.push("FAIL " + r.failure()?.errorText); });
page.on("console", (m) => { if (m.type() !== "log") reqs.push(m.type() + ": " + m.text().slice(0, 220)); });

await page.goto("https://hk-city-monitor.pages.dev", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const direct = await page.evaluate(async () => {
  try {
    const r = await fetch("https://resource.data.one.gov.hk/td/tc/specialtrafficnews.xml", { cache: "no-store" });
    const t = await r.text();
    return `status=${r.status} type=${r.type} len=${t.length} head=${t.slice(0, 60)}`;
  } catch (e) {
    return "THREW " + String(e).slice(0, 200);
  }
});

console.log("direct browser fetch:", direct);
const st = await page.evaluate(() => {
  const el = document.querySelector('[data-panel="special_traffic_list"]');
  return el ? (el.textContent || "").replace(/\s+/g, " ").slice(0, 120) : "no panel";
});
console.log("panel now:", st);
const html = await page.evaluate(() => document.querySelector('[data-panel="special_traffic_list"]')?.innerHTML ?? "");
console.log("panel html:", html.replace(/\s+/g, " ").slice(0, 700));
console.log("--- traffic requests/console ---\n" + (reqs.slice(0, 20).join("\n") || "(no request to that host at all)"));
await browser.close();
