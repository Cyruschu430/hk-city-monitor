// probe-mount.mjs — why does the app mount only N panels?
// The staleness probe reported "2 mounted (expected 18)". This dumps what is
// actually in the panel root, plus any boot error, so the cause is measured
// rather than guessed.
import { chromium } from "playwright-core";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:4173/";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });

const consoleMsgs = [];
const pageErrors = [];
page.on("console", (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(20000);

const snap = await page.evaluate(() => {
  const root = document.querySelector("#panels") ?? document.querySelector(".panels") ?? document.body;
  const mounted = [...document.querySelectorAll(".panel[data-panel]")].map((p) => ({
    id: p.dataset.panel,
    state: p.dataset.state,
  }));
  const hk = window.__hkcm ?? {};
  return {
    ready: document.body.dataset.ready,
    rootTag: root.tagName,
    rootId: root.id,
    rootClass: root.className,
    rootChildren: root.children.length,
    rootChildTags: [...root.children].slice(0, 30).map((c) => `${c.tagName}.${c.className}`),
    panelSectionsAnywhere: document.querySelectorAll(".panel").length,
    mounted,
    overviewIds: typeof hk.overviewIds === "function" ? hk.overviewIds() : null,
    tabs: typeof hk.tabs === "function" ? hk.tabs() : null,
    currentTab: typeof hk.currentTab === "function" ? hk.currentTab() : null,
    registryPanels: (hk.registry?.panels ?? []).length,
    workerBase: hk.workerBase ?? null,
    hiddenPanels: typeof hk.hiddenPanels === "function" ? hk.hiddenPanels() : null,
  };
});

console.log("=== MOUNT SNAPSHOT ===");
console.log(JSON.stringify(snap, null, 2));
console.log("\n=== PAGE ERRORS ===");
console.log(pageErrors.length ? pageErrors.join("\n") : "(none)");
console.log("\n=== CONSOLE (last 30) ===");
console.log(consoleMsgs.slice(-30).join("\n") || "(none)");

await browser.close();
