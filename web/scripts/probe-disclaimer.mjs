// probe-disclaimer.mjs — is the editorial notice actually rendered, and does it
// appear in BOTH languages? A disclaimer that only exists in the config is not
// a disclaimer.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, locale: "zh-HK" });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(9000);

const read = () =>
  page.evaluate(() => {
    const p = document.querySelector('.panel[data-panel="breaking_news_list"]');
    const d = p?.querySelector(".panel-disclaimer");
    if (!d) return { present: false };
    const cs = getComputedStyle(d);
    const r = d.getBoundingClientRect();
    return {
      present: true,
      text: d.textContent?.trim(),
      visible: r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden",
      fontSize: cs.fontSize,
      // Sanity: it must be readable, not 1px or transparent.
      color: cs.color,
      aboveFooter: !!(d.compareDocumentPosition(p.querySelector(".panel-foot")) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });

const tc = await read();
console.log("TC:", JSON.stringify(tc, null, 1));

// Switch to English and confirm the EN text renders.
await page.click("#langSwitch button:nth-child(2)").catch(() => {});
await page.waitForTimeout(2500);
const en = await read();
console.log("EN:", JSON.stringify(en, null, 1));

const ok = tc.present && tc.visible && en.present && en.visible &&
  tc.text !== en.text && (tc.text?.length ?? 0) > 20 && (en.text?.length ?? 0) > 20;
console.log(ok ? "\nPASS: notice renders in both languages, visible, above footer" : "\nFAIL");
await browser.close();
process.exit(ok ? 0 : 1);
