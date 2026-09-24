// probe-palette-why.mjs — the palette exists in the DOM but never opens.
// Narrow it down: is the keydown listener attached? does the event reach
// document? is createPalette called at all? Test by (a) dispatching a synthetic
// event, (b) checking for a boot error, (c) driving it via the real key path.
import { chromium } from "playwright-core";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:4173/";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });

const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errs.push(`[console] ${m.text()}`); });

await page.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(3000);

// Is anything listening on document for keydown at all?
const listenerProbe = await page.evaluate(() => {
  let sawKeydown = false;
  const spy = (e) => { sawKeydown = true; window.__spyKey = e.key; window.__spyCtrl = e.ctrlKey; };
  document.addEventListener("keydown", spy, true); // capture phase, runs first
  window.__removeSpy = () => document.removeEventListener("keydown", spy, true);
  const palette = document.querySelector(".palette");
  return {
    paletteInDom: !!palette,
    paletteParent: palette?.parentElement?.tagName ?? null,
    paletteHiddenAttr: palette?.hasAttribute("hidden") ?? null,
    paletteHiddenProp: palette?.hidden ?? null,
    bodyChildren: [...document.body.children].map((c) => `${c.tagName}.${c.className}`).slice(0, 14),
  };
});
console.log("listener probe:", JSON.stringify(listenerProbe, null, 2));

// Does a synthetic Ctrl+K reach document listeners?
const synthetic = await page.evaluate(() => {
  const before = document.querySelector(".palette")?.hidden;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true }));
  const after = document.querySelector(".palette")?.hidden;
  return { before, after };
});
console.log("synthetic document.dispatchEvent:", JSON.stringify(synthetic));

// Hide it again if the synthetic event worked, then use the REAL key path.
await page.evaluate(() => { const p = document.querySelector(".palette"); if (p) p.hidden = true; });
await page.click("body", { position: { x: 700, y: 500 } }).catch(() => {});
await page.keyboard.press("Control+k");
await page.waitForTimeout(500);
const real = await page.evaluate(() => ({
  hidden: document.querySelector(".palette")?.hidden ?? null,
  spySaw: window.__spyKey ?? null,
  spyCtrl: window.__spyCtrl ?? null,
  activeEl: document.activeElement?.className ?? document.activeElement?.tagName ?? null,
}));
console.log("real page.keyboard.press:", JSON.stringify(real));

// Also try the lowercase-key path via the input-less focus state.
await page.evaluate(() => { const p = document.querySelector(".palette"); if (p) p.hidden = true; });
await page.keyboard.down("Control");
await page.keyboard.press("KeyK");
await page.keyboard.up("Control");
await page.waitForTimeout(500);
const real2 = await page.evaluate(() => ({
  hidden: document.querySelector(".palette")?.hidden ?? null,
  spySaw: window.__spyKey ?? null,
}));
console.log("Control down + KeyK:", JSON.stringify(real2));

console.log("\npage errors:", errs.length ? errs.join("\n") : "(none)");
await browser.close();
