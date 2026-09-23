// probe-3d-error.mjs — why does the 3D error path not show a banner?
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "zh-HK" });

const blocked = [];
await page.route("**/config/3d*", (route) => {
  blocked.push(route.request().url());
  route.abort("failed");
});

await page.goto("http://localhost:4173/", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(12000);

const before = await page.evaluate(() => ({
  overlay: !!window.__overlay3d,
  state: window.__overlay3dState ? window.__overlay3dState() : "no hook",
}));
console.log("before click:", JSON.stringify(before));

const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
    (x.querySelector(".tip")?.textContent ?? "").includes("3D"));
  if (!b) return { found: false };
  b.setAttribute("aria-pressed", "false");
  const before = b.getAttribute("aria-pressed");
  b.click();
  return { found: true, before, after: b.getAttribute("aria-pressed"), tip: b.querySelector(".tip")?.textContent };
});
console.log("click:", JSON.stringify(clicked));
await page.waitForTimeout(4000);

const after = await page.evaluate(() => {
  const hud = document.querySelector("#mapHud .panel");
  return {
    overlay: !!window.__overlay3d,
    state: window.__overlay3dState ? window.__overlay3dState() : "no hook",
    bannerText: hud?.textContent?.slice(0, 120) ?? null,
    bannerDisplay: hud ? getComputedStyle(hud).display : null,
    allBanners: [...document.querySelectorAll("#mapHud .panel")].map((p) => p.textContent?.slice(0, 60)),
  };
});
console.log("after click:", JSON.stringify(after, null, 1));
console.log("blocked /config/3d calls:", blocked.length);
await browser.close();
