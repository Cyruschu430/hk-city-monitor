// probe-production-worker.mjs — is the app actually talking to the DEPLOYED
// Worker, and did the proxy sources come alive?
//
// This is the whole point of deploying: 103 of 175 sources are CORS-closed and
// only reachable through the Worker. Before deployment they failed; the claim
// here is that they now work, so it must be measured, not assumed.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, locale: "zh-HK" });

const workerCalls = [];
const failures = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("workers.dev")) workerCalls.push({ status: r.status(), url: u.slice(0, 110) });
});
page.on("requestfailed", (r) => {
  if (r.url().includes("workers.dev")) failures.push(`${r.failure()?.errorText} ${r.url().slice(0, 90)}`);
});

await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(16000);

const state = await page.evaluate(() => {
  const hk = window.__hkcm;
  const panels = [...document.querySelectorAll(".panel[data-panel]")].map((p) => ({
    id: p.dataset.panel,
    state: p.dataset.state,
  }));
  return {
    workerBase: hk?.workerBase ?? null,
    hasWorker: hk?.hasWorker ?? null,
    coverage: document.querySelector(".cover-text")?.textContent?.trim() ?? null,
    live: panels.filter((p) => p.state === "live").length,
    stale: panels.filter((p) => p.state === "stale").length,
    error: panels.filter((p) => p.state === "error").length,
    total: panels.length,
    erroredPanels: panels.filter((p) => p.state === "error").map((p) => p.id),
  };
});

console.log("workerBase :", state.workerBase);
console.log("hasWorker  :", state.hasWorker);
console.log("coverage   :", state.coverage);
console.log(`panels     : ${state.live} live / ${state.stale} stale / ${state.error} error  (of ${state.total})`);
if (state.erroredPanels.length) console.log("errored    :", state.erroredPanels.join(", "));

const ok200 = workerCalls.filter((c) => c.status === 200).length;
console.log(`\nWorker calls: ${workerCalls.length} total, ${ok200} returned 200`);
for (const c of workerCalls.slice(0, 6)) console.log(`  ${c.status}  ${c.url}`);
if (failures.length) {
  console.log("\nFAILED worker requests:");
  for (const f of failures.slice(0, 5)) console.log("  " + f);
}

const targets = workerCalls.filter((c) => /weather\.gov\.hk|info\.gov\.hk|hongkongairport|mardep|rthk|news\.gov\.hk/.test(c.url));
console.log(`\nCORS-closed sources reached via the deployed Worker: ${targets.length}`);
console.log(targets.length > 0 ? "\nPASS: the deployed Worker is serving the closed sources" : "\nFAIL: no closed source went through the Worker");
await browser.close();
