// check-quota.mjs — the number SECURITY.md 8.1 quotes, kept true by a check.
//
// 8.1 makes a capacity claim: "N cold loads before the Workers free tier is gone". That claim
// is only a fact while something measures it. Every panel added to OVERVIEW, every overlay
// turned on by default, every source that stops being CORS-open and moves to the proxy, moves
// the number — silently, in the wrong direction, and nothing in the build notices. A build
// that succeeds says nothing about how many invocations a visitor costs.
//
// MEASURED 2026-09-27, cold load: 26 Worker requests. SECURITY.md said 49 (the estimate was
// made from the registry's source count, not from a load), which understated capacity by half.
// The real constraint is Cloudflare's 100,000 requests/day; at 26 the ceiling is ~3,846 cold
// loads/day, and exceeding it is Error 1027 — the whole site down until midnight UTC, no bill.
//
// Budget is 26 measured + 30% = 34. Loose enough not to fail on a retry, tight enough that
// adding five eager panels trips it. If this fails, the question is not "raise the budget" —
// it is whether the new panels belong on the first paint at all.
//
// Usage: node scripts/check-quota.mjs [baseUrl]

import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:4173/";
const BUDGET = 34;
const SETTLE_MS = 35_000; // long enough for the below-the-fold panels to fire

// The same bundled Chromium the other checks use. Playwright's own default here is
// chrome-headless-shell, which is not the browser this repo has installed — launching with no
// executablePath fails outright (measured: "Executable doesn't exist at
// ...chromium_headless_shell-1243..."). CHROME_PATH overrides it for a different machine.
const exe = process.env.CHROME_PATH
  ?? "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });

const worker = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("workers.dev") || u.includes("/proxy?url=")) worker.push(u);
});

await page.goto(BASE, { waitUntil: "domcontentloaded" });
let booted = false;
for (let attempt = 1; attempt <= 2 && !booted; attempt++) {
  try {
    await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
    booted = true;
  } catch {
    if (attempt === 1) await page.goto(BASE, { waitUntil: "domcontentloaded" });
  }
}
if (!booted) {
  console.error("readiness timeout on both attempts: the app never booted, so its quota cost is unknown.");
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(SETTLE_MS);

// Attribute each hit to its upstream target, so a regression points at a source and not just a
// number. That is the difference between "quota went up" and "someone made the camera wall eager".
const byTarget = new Map();
for (const u of worker) {
  const m = u.match(/[?&]url=([^&]+)/);
  const target = m ? decodeURIComponent(m[1]).replace(/^https?:\/\//, "") : u;
  byTarget.set(target, (byTarget.get(target) ?? 0) + 1);
}
const targets = [...byTarget.entries()].sort((a, b) => b[1] - a[1]);

console.log(`cold load: ${worker.length} Worker request(s), ${byTarget.size} distinct target(s)`);
for (const [t, n] of targets) console.log(`  ${String(n).padStart(3)} x  ${t.slice(0, 96)}`);
console.log(`capacity: 100000 / ${worker.length} = ${Math.floor(100000 / Math.max(worker.length, 1))} cold loads/day`);

await browser.close();

if (worker.length > BUDGET) {
  console.error(`\nQUOTA BUDGET EXCEEDED: ${worker.length} > ${BUDGET}.`);
  console.error("Each request is one invocation against 100,000/day, cache hit or not.");
  console.error("Either take the new panels off the first paint, or move the source off the proxy.");
  process.exit(1);
}
console.log(`\nQUOTA OK  (budget ${BUDGET}, measured ${worker.length})`);
