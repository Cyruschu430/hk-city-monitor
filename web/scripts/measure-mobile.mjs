// measure-mobile.mjs — what the phone shell actually looks like, in numbers.
//
// The phone complaints are geometry: "the layer panel covers the whole map" and
// "no panel below is visible and it will not scroll". Both are measurable without
// a screenshot, and both are exactly the kind of claim a desktop-tuned harness
// never asks about, so this measures the shell at phone sizes and prints a report.
//
// Usage (on the PC, which is where Chrome and the tunnel live):
//   node measure-mobile.mjs [url]
// Exit code 1 = the map is covered, or a panel cannot be reached at all.
import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "https://hk-city-monitor.pages.dev";
const exe = process.env.CHROME_PATH ?? "C:\\Users\\<user>\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const SIZES = [
  { name: "iPhone 12 (390x844, browser chrome shown)", w: 390, h: 700 },
  { name: "small Android (360x640)", w: 360, h: 600 },
  // A phone fix must not quietly break the desktop shell, so the same report runs there.
  { name: "desktop baseline (1440x900)", w: 1440, h: 900 },
];

const browser = await chromium.launch({ executablePath: exe, headless: true });
const problems = [];

for (const size of SIZES) {
  const page = await browser.newPage({
    viewport: { width: size.w, height: size.h },
    locale: "zh-HK",
    hasTouch: size.w < 900,
    isMobile: size.w < 900,
    deviceScaleFactor: 2,
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
    problems.push(`${size.name}: the app never booted`);
    await page.close();
    continue;
  }
  await page.waitForTimeout(9000);

  const m = await page.evaluate(() => {
    const R = (sel) => {
      const e = typeof sel === "string" ? document.querySelector(sel) : sel;
      if (!e) return null;
      const b = e.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom), right: Math.round(b.right) };
    };
    const inter = (a, b) => {
      if (!a || !b) return 0;
      const ox = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
      const oy = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
      return Math.round((ox * oy) / 1000);
    };
    const mapWrap = R("#mapWrap");
    const map = R("#map");
    const lyr = R(".layer-control");
    const panelsEl = document.querySelector("#panels");
    const anyOverlayHidden = document.querySelector(".layer-control")?.hasAttribute("hidden") ?? null;
    // What fraction of the MAP the layer control sits on top of.
    const covered = map ? Math.round((inter(lyr, map) * 1000) / (map.w * map.h) * 100) : null;
    // Can the panel column be scrolled at all, and is its content reachable?
    const last = [...document.querySelectorAll("#panels section.panel")].pop();
    let reachable = null;
    if (panelsEl && last) {
      panelsEl.scrollTop = panelsEl.scrollHeight;
      reachable = R(last).bottom <= R(panelsEl).bottom + 4;
      panelsEl.scrollTop = 0;
    }
    return {
      viewportH: innerHeight,
      visualH: Math.round(window.visualViewport?.height ?? -1),
      statusbar: R("#statusbar"),
      layout: R("#layout"),
      mapWrap, map, panelCol: R("#panelCol"), panels: R(panelsEl),
      lyrRect: lyr, lyrHidden: anyOverlayHidden,
      mapCoveredPct: covered,
      panelCount: document.querySelectorAll("#panels section.panel").length,
      panelsScroll: panelsEl ? { scrollH: panelsEl.scrollHeight, clientH: panelsEl.clientHeight, canScroll: panelsEl.scrollHeight > panelsEl.clientHeight + 4 } : null,
      mapBandPct: mapWrap && innerHeight ? Math.round((mapWrap.h / innerHeight) * 100) : null,
      panelBandPx: R("#panelCol")?.h ?? null,
      lastPanelReachable: reachable,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2,
      bodyScrollH: document.body.scrollHeight,
      bodyChildren: [...document.body.children].map((e) => ({
        tag: e.tagName.toLowerCase() + (e.id ? `#${e.id}` : "") + (e.className && typeof e.className === "string" ? `.${e.className.split(" ")[0]}` : ""),
        y: Math.round(e.getBoundingClientRect().y),
        h: Math.round(e.getBoundingClientRect().height),
        hidden: e.hasAttribute("hidden"),
        display: getComputedStyle(e).display,
      })),
      panelColChildren: [...(document.querySelector("#panelCol")?.children ?? [])].map((e) => ({
        tag: e.tagName.toLowerCase() + (e.id ? `#${e.id}` : "") + (e.className && typeof e.className === "string" ? `.${e.className.split(" ")[0]}` : ""),
        y: Math.round(e.getBoundingClientRect().y),
        h: Math.round(e.getBoundingClientRect().height),
        hidden: e.hasAttribute("hidden"),
        overflow: getComputedStyle(e).overflow,
      })),
      panelsStyle: (() => { const cs = getComputedStyle(document.querySelector("#panels")); return { display: cs.display, flex: `${cs.flexGrow}/${cs.flexShrink}/${cs.flexBasis}`, minH: cs.minHeight, gridRows: cs.gridTemplateRows, gridCols: cs.gridTemplateColumns, alignContent: cs.alignContent }; })(),
      panelColStyle: (() => { const cs = getComputedStyle(document.querySelector("#panelCol")); return { display: cs.display, overflow: cs.overflow, minH: cs.minHeight, h: cs.height }; })(),
    };
  });

  console.log(`\n=== ${size.name} ===`);
  console.log(`viewport ${m.viewportH}px (visual ${m.visualH}px)  body scrollHeight ${m.bodyScrollH}`);
  console.log(`statusbar h=${m.statusbar?.h}  #layout y=${m.layout?.y} h=${m.layout?.h}`);
  console.log(`map band    ${JSON.stringify(m.mapWrap)}  (${m.mapBandPct}% of viewport)`);
  console.log(`panel band  ${JSON.stringify(m.panelCol)}`);
  console.log(`layer ctrl  ${JSON.stringify(m.lyrRect)} hidden=${m.lyrHidden}`);
  console.log(`  -> layer control covers ${m.mapCoveredPct}% of the map's area`);

  // THE CLOSE BUTTON MUST SURVIVE BEING OPENED. The head is the only way to put the list
  // away; the expanded control used to be taller than the map band, which pushed the head
  // off the top edge — you could open the list on a phone and not close it. Expand it here
  // and assert the button is still inside the viewport.
  if (size.w < 900) {
    const expanded = await page.evaluate(async () => {
      const head = document.querySelector(".layer-control .lyr-head");
      if (!(head instanceof HTMLElement)) return null;
      head.click();
      await new Promise((r) => setTimeout(r, 350));
      const hr = head.getBoundingClientRect();
      const cr = document.querySelector(".layer-control").getBoundingClientRect();
      const body = document.querySelector(".layer-control .lyr-body");
      return {
        headY: Math.round(hr.y),
        headH: Math.round(hr.height),
        ctrlTop: Math.round(cr.y),
        ctrlBottom: Math.round(cr.bottom),
        bodyDisplay: body ? getComputedStyle(body).display : "missing",
      };
    });
    if (!expanded) {
      problems.push(`${size.name}: no .layer-control .lyr-head to expand`);
    } else {
      console.log(`expanded    head y=${expanded.headY} h=${expanded.headH}  control ${expanded.ctrlTop}..${expanded.ctrlBottom}  body=${expanded.bodyDisplay}`);
      if (expanded.bodyDisplay === "none") problems.push(`${size.name}: the head did not open the list`);
      if (expanded.headY < 0) {
        problems.push(`${size.name}: the CLOSE button is off the top of the screen while the list is open (head y=${expanded.headY})`);
      }
      await page.evaluate(() => document.querySelector(".layer-control .lyr-head")?.click());
      await page.waitForTimeout(250);
    }
  }
  console.log(`#panels     ${JSON.stringify(m.panels)} scroll=${JSON.stringify(m.panelsScroll)}`);
  console.log(`panels=${m.panelCount}  last panel reachable by scrolling: ${m.lastPanelReachable}`);
  console.log(`horizontal overflow: ${m.horizontalOverflow}`);
  console.log(`body children: ${JSON.stringify(m.bodyChildren, null, 0)}`);
  console.log(`#panelCol children: ${JSON.stringify(m.panelColChildren, null, 0)}`);
  console.log(`#panels style: ${JSON.stringify(m.panelsStyle)}`);
  console.log(`#panelCol style: ${JSON.stringify(m.panelColStyle)}`);

  if (m.horizontalOverflow) problems.push(`${size.name}: page overflows horizontally`);
  if (size.w < 900 && m.mapCoveredPct !== null && m.mapCoveredPct > 12) {
    problems.push(`${size.name}: the layer control covers ${m.mapCoveredPct}% of the map`);
  }
  if (size.w < 900 && !m.panelsScroll?.canScroll && m.panelCount > 0) {
    problems.push(`${size.name}: the panel column cannot scroll (${JSON.stringify(m.panelsScroll)})`);
  }
  if (size.w < 900 && m.lastPanelReachable === false) {
    problems.push(`${size.name}: the last panel is unreachable even at full scroll`);
  }
  await page.close();
}

await browser.close();
console.log("");
if (problems.length) {
  for (const p of problems) console.log(`PROBLEM  ${p}`);
  console.log(`\nMOBILE LAYOUT: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log("MOBILE LAYOUT OK");
