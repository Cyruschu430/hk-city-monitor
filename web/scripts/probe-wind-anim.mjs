// probe-wind-anim.mjs — is the wind particle layer ACTUALLY animating?
//
// AGENTS.md: "deck.gl needs a real GPU and a headed run, so a headless pass says
// nothing about the deck.gl path." So this runs HEADED by default. A headless run
// against SwiftShader will happily render a single frame and report success.
//
// The test is pixel motion, not presence: sample the map canvas twice ~700ms
// apart and count how many pixels changed. A static-but-correct layer (image
// loaded, particles drawn once, never stepped) is exactly the failure being
// chased, and it looks identical to a working one in any single screenshot.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const url = process.argv[2] ?? "http://localhost:4173/";
const headed = process.argv[3] !== "headless";

const browser = await chromium.launch({
  executablePath: exe,
  headless: !headed,
  args: headed ? [] : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, locale: "zh-HK" });

const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text().slice(0, 240)}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${String(e).slice(0, 240)}`));

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(3000);

console.log("webgl2 :", await page.evaluate(() => {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2");
  if (!gl) return "NO WEBGL2";
  const d = gl.getExtension("WEBGL_debug_renderer_info");
  return d ? String(gl.getParameter(d.UNMASKED_RENDERER_WEBGL)) : "webgl2 ok (renderer hidden)";
}));

// Turn the wind layer ON from the rail.
await page.evaluate(() => {
  [...document.querySelectorAll("#rail .rail-btn")]
    .find((x) => (x.querySelector(".tip")?.textContent ?? "").includes("風場"))?.click();
});
await page.waitForFunction(() => Boolean(window.__windField), null, { timeout: 60_000 }).catch(() => {});
await page.waitForTimeout(4000);

const state = await page.evaluate(() => {
  const m = window.__map;
  const canvases = [...document.querySelectorAll("canvas")].map((c) => ({
    cls: c.className || "(none)",
    w: c.width,
    h: c.height,
    visible: c.getBoundingClientRect().width > 0,
    opacity: getComputedStyle(c).opacity,
    display: getComputedStyle(c).display,
  }));
  const controls = (m?._controls ?? []).map((c) => c?.constructor?.name ?? typeof c);
  return { field: window.__windField ?? null, canvases, controls, windOn: window.__hkcm?.layersOn?.() ?? null };
});
console.log("field  :", JSON.stringify(state.field));
console.log("windOn :", JSON.stringify(state.windOn));
console.log("controls:", JSON.stringify(state.controls));
console.log("canvases:");
for (const c of state.canvases) console.log("   ", JSON.stringify(c));

// PIXEL MOTION. Sample a central region of the map face twice.
const sample = async () =>
  page.evaluate(() => {
    const m = window.__map;
    const src = m.getCanvas();
    const w = 420;
    const h = 300;
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d");
    ctx.drawImage(src, Math.round(src.width / 2 - w / 2), Math.round(src.height / 2 - h / 2), w, h, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    // Keep a sparse fingerprint so returning it over CDP is cheap.
    const out = new Array((w * h) / 16);
    for (let i = 0, j = 0; i < d.length; i += 64, j++) out[j] = d[i] + d[i + 1] * 256 + d[i + 2] * 65536;
    return out;
  });

const a = await sample();
await page.waitForTimeout(700);
const b = await sample();
await page.waitForTimeout(700);
const c = await sample();
const diff = (x, y) => x.reduce((n, v, i) => n + (v === y[i] ? 0 : 1), 0);
console.log(`pixel motion  t0→t1: ${diff(a, b)}/${a.length} samples changed (${((diff(a, b) / a.length) * 100).toFixed(1)}%)`);
console.log(`pixel motion  t1→t2: ${diff(b, c)}/${b.length} samples changed (${((diff(b, c) / b.length) * 100).toFixed(1)}%)`);

// Does the deck overlay instance think it has layers?
console.log("deck layers:", JSON.stringify(await page.evaluate(() => {
  const m = window.__map;
  const ov = (m?._controls ?? []).find((x) => x && typeof x.setProps === "function");
  if (!ov) return "no MapboxOverlay found";
  const props = ov.props ?? {};
  return {
    interleaved: props.interleaved ?? null,
    layerIds: (props.layers ?? []).map((l) => l?.id ?? "?"),
    animate: (props.layers ?? []).map((l) => l?.props?.animate ?? null),
  };
})));

console.log("\nconsole:");
for (const l of logs.slice(0, 18)) console.log("  " + l);
await page.screenshot({ path: "test/artifacts/wind-anim.png" });
await browser.close();
