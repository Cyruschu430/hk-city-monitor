// probe-palette.mjs — does ⌘K actually open, in isolation?
// verify-browser.mjs reports open=false hits=0. The palette toggles
// (open ? close() : openIt()), so a SECOND Ctrl+K closes it — which would make
// a failure here a test artefact, not a product bug. Measure the first press
// separately from the second before concluding anything.
import { chromium } from "playwright-core";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:4173/";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await page.goto(URL_UNDER_TEST, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(4000);

const state = async (label) => {
  const s = await page.evaluate(() => {
    const p = document.querySelector(".palette");
    return {
      exists: !!p,
      hidden: p ? p.hidden : null,
      visible: p ? !p.hidden : null,
      items: document.querySelectorAll(".palette-item").length,
      activeEl: document.activeElement?.className ?? document.activeElement?.tagName ?? null,
    };
  });
  console.log(`${label.padEnd(34)} ${JSON.stringify(s)}`);
  return s;
};

await state("initial");
await page.keyboard.press("Control+k");
await page.waitForTimeout(400);
const first = await state("after FIRST Ctrl+K");
await page.type(".palette-input", "尖沙咀").catch(() => console.log("  (input not focusable)"));
await page.waitForTimeout(600);
await state("after typing 尖沙咀");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await state("after Escape");
await page.keyboard.press("Control+k");
await page.waitForTimeout(400);
const second = await state("after SECOND Ctrl+K");

console.log(
  `\nfirst press opened: ${first.visible === true} · second press visible: ${second.visible === true}` +
    `\n(if first=true and second=true, alternating works; verify-browser saw false because an earlier press toggled it)`,
);
await browser.close();
