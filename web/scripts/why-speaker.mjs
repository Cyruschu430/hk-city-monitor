// why-speaker.mjs — one question: is there a speaker in the brief panel, and if not, why not?
import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: "zh-HK" });
await page.goto(process.env.HKCM_URL ?? "https://hk-city-monitor.pages.dev", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(6000);
const r = await page.evaluate(() => {
  const panel = document.querySelector('[data-panel="ai_brief"]');
  const li = panel?.querySelector("li");
  return {
    panel: !!panel,
    html: panel ? panel.innerHTML.slice(0, 400) : null,
    rows: panel ? panel.querySelectorAll("li").length : 0,
    anySpeak: document.querySelectorAll(".speak-btn").length,
    hasSynth: typeof window.speechSynthesis,
    hasUtter: typeof window.SpeechSynthesisUtterance,
    voices: (window.speechSynthesis?.getVoices?.() ?? []).map((v) => v.lang),
    // the payload the panel read
    payload: null,
  };
});
const payload = await page.evaluate(async () => {
  try {
    const j = await (await fetch("./data/ai_summary.json")).json();
    return { keys: Object.keys(j.brief ?? {}), spoken: String(j.brief?.spoken_tc ?? "").slice(0, 30), generated: j.generated };
  } catch (e) { return { err: String(e) }; }
});
console.log(JSON.stringify({ ...r, payload }, null, 1));
await browser.close();
