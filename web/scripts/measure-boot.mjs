// measure-boot.mjs — what actually crosses the wire on a cold first paint.
//
// "Two ~930KB chunks" was the framing that started this; the measurement disagreed. Only ONE
// of them is on the critical path (index.html modulepreloads it) and the other never loads
// until the 3D toggle is pressed. A size in the build log is not a cost — a size in
// index.html's preload graph is. This prints the second one.
//
//   node scripts/measure-boot.mjs          # needs `npx vite preview --host 127.0.0.1` up
import { chromium } from "playwright-core";

const BASE = process.env.HKCM_URL ?? (process.env.HKCM_URL ?? process.env.BASE ?? "http://localhost:4173/");
const exe = process.env.HKCM_CHROME ?? "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });
const files = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/\.(js|css|json)$/.test(u)) return;
  let size = 0;
  try { size = (await r.body()).length; } catch {}
  files.push({ url: u.split("/").pop(), type: r.request().resourceType(), bytes: size });
});

// One retry, because a cold browser backend can lose the FIRST navigation — measured twice in
// this repo (a fresh preview + a fresh browser reports "never booted" once, then the identical
// run succeeds). Treating that as a result would either hide real breakage behind a flake, or
// cry wolf on a healthy build. A second failure IS a result.
let bootMs = 0;
let ready = false;
for (let attempt = 1; attempt <= 2 && !ready; attempt++) {
  files.length = 0;
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 });
    ready = true;
    bootMs = Date.now() - t0;
    if (attempt > 1) console.log(`(booted on retry ${attempt} - the first navigation was a cold-start miss)`);
  } catch {}
}
if (!ready) {
  console.error("readiness timeout on both attempts: the app never booted, so these numbers mean nothing.");
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(8000);

const js = files.filter((f) => f.type === "script").reduce((s, f) => s + f.bytes, 0);
const css = files.filter((f) => f.type === "stylesheet").reduce((s, f) => s + f.bytes, 0);
const data = files.filter((f) => f.type === "fetch").reduce((s, f) => s + f.bytes, 0);

console.log(`boot (domcontentloaded -> ready): ${bootMs}ms`);
console.log(`files: ${files.length}   total: ${files.reduce((s, f) => s + f.bytes, 0)} bytes`);
console.log(`  JS ${js}  CSS ${css}  DATA ${data}`);
console.log("--- largest first ---");
for (const f of [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 14)) {
  console.log(`${String(f.bytes).padStart(9)}  ${f.type.padEnd(10)} ${f.url}`);
}
// The 3D half must NOT appear here. If it does, a manualChunks change hoisted it onto the
// critical path - see the note at the bottom of vite.config.ts.
const hoisted = files.filter((f) => /vis-3d|deck|luma|webgl-device|tiles-3d/.test(f.url));
console.log(hoisted.length ? `\nFAIL: 3D code is on the critical path: ${hoisted.map((f) => f.url).join(", ")}` : "\nOK: no 3D/lazy chunk on the critical path");
await browser.close();
process.exit(hoisted.length ? 1 : 0);
