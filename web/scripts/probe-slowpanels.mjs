// probe-slowpanels.mjs — time the three panels that were reported as timing out.
// The app renders every panel in the column, so nothing needs clicking: wait for the panel element,
// then wait for it to stop saying "loading" and say something.
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "https://hk-city-monitor.pages.dev";
const LIMIT_MS = Number(process.argv[3] ?? 60000);
const ids = ["special_traffic_list", "carpark_vacancy_list", "mtr_next_train_list"];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/chromium-browser",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const noise = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") noise.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
page.on("requestfailed", (r) => noise.push(`requestfailed: ${r.url().slice(0, 140)} ${r.failure()?.errorText ?? ""}`));
page.on("response", (r) => { if (r.status() >= 400) noise.push(`http ${r.status()}: ${r.url().slice(0, 140)}`); });

const t0 = Date.now();
await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });

const read = (pid) =>
  page.evaluate((p) => {
    const el = document.querySelector(`[data-panel="${p}"]`);
    if (!el) return { found: false, text: "" };
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    // the panel's own title comes first, so "starts with 載入" never matches — look for the phrase
    const busy = !!el.querySelector(".skel, .skeleton, [aria-busy=true]") || /載入中|Loading…|loading\.\.\./.test(text);
    return { found: true, busy, text: text.slice(0, 90), len: text.length };
  }, pid);

const out = {};
for (const id of ids) {
  // panels load when they come into view, so a probe that never scrolls measures the probe
  await page.evaluate((p) => document.querySelector(`[data-panel="${p}"]`)?.scrollIntoView({ block: "center" }), id);
  const start = Date.now();
  let last = { found: false };
  while (Date.now() - start < LIMIT_MS) {
    last = await read(id);
    if (last.found && !last.busy && last.len > 20) break;
    await page.waitForTimeout(750);
  }
  out[id] = { ms: Date.now() - start, ...last };
}

console.log("page ready +" + (Date.now() - t0) + "ms");
for (const [k, v] of Object.entries(out)) {
  console.log(`${k}: ${v.found ? (v.busy ? "STILL LOADING" : "ok") : "NO PANEL"} after ${v.ms}ms — "${v.text}"`);
}
console.log("--- noise ---");
console.log(noise.slice(0, 20).join("\n") || "(none)");
await browser.close();
