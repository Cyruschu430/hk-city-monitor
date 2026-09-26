// 用合成 brief 驗 timeline render —— 呢個視圖用真數據要等 14 日基線成熟
import { chromium } from "playwright-core";
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: "zh-HK" });
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 180)); });
await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
try { await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 }); } catch {}
await page.waitForTimeout(12000);

const brief = {
  generatedAt: new Date().toISOString(), mode: "template",
  facts: [], convergences: [],
  convergenceDetail: [
    { district: "沙田區", domains: ["water", "traffic", "health"], score: 18, maxSeverity: 3,
      from: new Date(Date.now() - 80 * 60000).toISOString(), to: new Date(Date.now() - 5 * 60000).toISOString(),
      events: [
        { at: new Date(Date.now() - 80 * 60000).toISOString(), domain: "water", severity: 2, ruleId: "wsd_suspension_count", headline: { tc: "停水通知 3 宗", en: "3 water suspensions" }, observed: 3, threshold: 2 },
        { at: new Date(Date.now() - 45 * 60000).toISOString(), domain: "traffic", severity: 1, ruleId: "td_special_count", headline: { tc: "特別交通消息 12 宗", en: "12 traffic notices" }, observed: 12, threshold: 10 },
        { at: new Date(Date.now() - 5 * 60000).toISOString(), domain: "health", severity: 3, ruleId: "ae_wait_over", headline: { tc: "急症室輪候超過兩小時", en: "A&E wait over 2 hours" }, observed: 180, threshold: 120 },
      ] },
  ],
  accumulating: [{ signal: "ha_ae_waiting", days: 5, required: 14 }],
};
console.log("feedAnalysis:", await page.evaluate((b) => {
  const w = window.__hkcm;
  if (!w || typeof w.feedAnalysis !== "function") return "NO feedAnalysis HOOK";
  w.feedAnalysis(b); return "ok";
}, brief));
await page.waitForTimeout(2500);

const r = await page.evaluate(() => {
  const p = document.querySelector('[data-panel="analysis_brief"]');
  return {
    state: p?.dataset.state,
    tlGroups: p?.querySelectorAll(".tl-g").length,
    tlRows: p?.querySelectorAll(".tl-ev").length,
    groupHead: p?.querySelector(".tl-gh")?.textContent?.replace(/\s+/g, " ").trim(),
    score: p?.querySelector(".tl-score")?.textContent,
    span: p?.querySelector(".tl-span")?.textContent,
    rows: [...(p?.querySelectorAll(".tl-ev") ?? [])].map((x) => ({
      txt: x.textContent.replace(/\s+/g, " ").trim(), cls: x.className,
      borderL: getComputedStyle(x).borderLeftColor,
    })),
    panelH: Math.round(p?.getBoundingClientRect().height ?? 0),
    fontSizes: [...(p?.querySelectorAll(".tl-ev time, .tl-txt, .tl-num, .tl-d") ?? [])].map((x) => getComputedStyle(x).fontSize),
  };
});
console.log(JSON.stringify(r, null, 1));
console.log("errors:", [...new Set(errs)].slice(0, 4));
await browser.close();
