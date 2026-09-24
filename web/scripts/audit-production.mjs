// audit-production.mjs — a full defect sweep of the running app.
//
// One pass that answers: which panels are not live, what error does each show,
// which requests fail, and are there any console errors or layout overflows.
// "No bugs" needs a measurement, not an impression.
import { chromium } from "playwright-core";

const base = process.argv[2] || "http://localhost:4173/";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });

const badStatus = [];
const failed = [];
const consoleErrors = [];
page.on("response", (r) => {
  if (r.status() >= 400) badStatus.push(`${r.status()} ${decodeURIComponent(r.url()).slice(0, 130)}`);
});
page.on("requestfailed", (r) => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 110)}`));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
});
page.on("pageerror", (e) => consoleErrors.push("PAGEERROR " + e.message.slice(0, 200)));

await page.addInitScript(() => {
  try {
    for (const k of ["hkcm.layers", "hkcm.panelsHidden", "hkcm.theme", "hkcm.lang"]) localStorage.removeItem(k);
  } catch {}
});

await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 });
await page.waitForTimeout(18000);

// Walk every category tab so panels that only mount on a tab are exercised.
const tabs = await page.evaluate(() => window.__hkcm?.tabs?.() ?? []);
for (const t of tabs) {
  if (!t) continue;
  await page.evaluate((id) => {
    const b = [...document.querySelectorAll("#panelTabs .ptab")].find((x) => x.dataset.group === id);
    b?.click();
  }, t);
  await page.waitForTimeout(2500);
}
// Back to 全部.
await page.evaluate(() => {
  const b = [...document.querySelectorAll("#panelTabs .ptab")].find((x) => x.dataset.group === "");
  b?.click();
});
await page.waitForTimeout(4000);

// Walk every mode.
const modes = ["總覽", "颱風", "口岸", "停水", "請假"];
for (const m of modes) {
  await page.evaluate((needle) => {
    const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) => (x.querySelector(".tip")?.textContent ?? "").includes(needle));
    b?.click();
  }, m);
  await page.waitForTimeout(7000);
}

await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("總覽"));
  b?.click();
});
await page.waitForTimeout(5000);

const panels = await page.evaluate(() =>
  [...document.querySelectorAll(".panel[data-panel]")].map((p) => ({
    id: p.dataset.panel,
    state: p.dataset.state,
    body: (p.querySelector(".panel-body")?.textContent ?? "").trim().slice(0, 90),
  })),
);

const layout = await page.evaluate(() => {
  const de = document.documentElement;
  const panelsHost = document.getElementById("panels");
  const overflowing = [...document.querySelectorAll(".panel")].filter((p) => p.scrollWidth > p.clientWidth + 2).map((p) => p.dataset.panel);
  return {
    docScrollW: de.scrollWidth,
    innerW: window.innerWidth,
    panelsScrollW: panelsHost?.scrollWidth ?? 0,
    panelsClientW: panelsHost?.clientWidth ?? 0,
    overflowingPanels: overflowing,
  };
});

const notLive = panels.filter((p) => p.state !== "live");
console.log(`=== PANELS: ${panels.length} total, ${panels.filter((p) => p.state === "live").length} live, ${notLive.length} NOT live ===`);
for (const p of notLive) console.log(`  [${p.state}] ${p.id}: ${p.body}`);

console.log(`\n=== LAYOUT ===`);
console.log(`  doc ${layout.docScrollW} vs viewport ${layout.innerW} (overflow ${layout.docScrollW - layout.innerW})`);
console.log(`  panels ${layout.panelsScrollW} vs ${layout.panelsClientW}`);
console.log(`  panels with inner overflow: ${layout.overflowingPanels.join(", ") || "(none)"}`);

const uniqBad = [...new Set(badStatus)];
console.log(`\n=== HTTP >= 400 (${uniqBad.length} unique) ===`);
for (const b of uniqBad.slice(0, 30)) console.log("  " + b);

console.log(`\n=== FAILED REQUESTS (${failed.length}) ===`);
for (const f of [...new Set(failed)].slice(0, 15)) console.log("  " + f);

console.log(`\n=== CONSOLE ERRORS (${consoleErrors.length}) ===`);
for (const c of consoleErrors.slice(0, 12)) console.log("  " + c);

await browser.close();
