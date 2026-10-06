// probe-orphan-layers.mjs — does the 口岸模式 control-point layer survive its own
// mode switch?
//
// Hypothesis (from reading, NOT yet measured): `controlPointLayer()` adds layers
// under the BARE id `vl-control_points` plus `vl-control_points-label`, but
// `clearVerticalLayers()` removes only the ids in `layersOf(def)` — the suffixed
// family. The bare `vl-control_points` is not in that list, so it would outlive
// the mode and paint over whatever comes next. That is exactly the failure the
// comment above `layersOf` says the list exists to prevent, which is why it is
// worth measuring rather than assuming.
//
// This enumerates EVERY `vl-` layer on the map after each mode crossing and
// diffs it against what the mode says it drew, so an orphan names itself.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\<user>\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const url = process.argv[2] ?? "http://localhost:4173/";
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, locale: "zh-HK" });
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
await page.waitForTimeout(4000);

const snap = () =>
  page.evaluate(() => ({
    mode: window.__hkcm?.currentMode?.() ?? null,
    drawn: window.__hkcm?.drawnLayers?.() ?? [],
    vl: window.__map
      .getStyle()
      .layers.map((l) => l.id)
      .filter((id) => id.startsWith("vl-")),
  }));

const mode = async (label) => {
  const ok = await page.evaluate((needle) => {
    const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
      (x.querySelector(".tip")?.textContent ?? "").includes(needle),
    );
    if (!b) return false;
    b.click();
    return true;
  }, label);
  if (!ok) throw new Error(`rail not found: ${label}`);
  await page.waitForTimeout(7000);
};

const show = (tag, s) => console.log(`${tag.padEnd(12)} mode=${String(s.mode).padEnd(14)} drawn=${JSON.stringify(s.drawn)} vl=${JSON.stringify(s.vl)}`);

// Baseline: what does a mode that draws NO vertical layers look like?
await mode("總覽");
const base = await snap();
show("總覽", base);

for (const [label, name] of [["口岸模式", "border"], ["停水模式", "water"], ["總覽", "overview"]]) {
  await mode(label);
  const s = await snap();
  show(`${name}`, s);
  // Orphans = vl- layers still present that this mode does not claim. A mode
  // claims `vl-<id>` AND its whole `vl-<id>-*` family — matching on the exact id
  // only would flag every legitimately-drawn suffixed layer as an orphan, which
  // is how a probe ends up reporting five problems and hiding the real one.
  const claimed = s.drawn.map((d) => `vl-${d}`);
  const isClaimed = (id) => claimed.some((c) => id === c || id.startsWith(`${c}-`));
  const orphans = s.vl.filter((id) => !isClaimed(id) && !id.includes("cameras-"));
  if (orphans.length) console.log(`   !! ORPHANS after ${name}: ${JSON.stringify(orphans)}`);
}

await browser.close();
