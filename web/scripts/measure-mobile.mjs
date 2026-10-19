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
import { browserExe } from "./browser.mjs";

const BASE = process.argv[2] ?? "https://hk-city-monitor.pages.dev";
const exe = browserExe();
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

  // NOTHING MAY SIT ON THE ATTRIBUTION LINE. The credit block wraps to three lines on a
  // phone, so it grew upward past both bottom-anchored controls — the LandsD notice and the
  // layer button were printed over the white text. The desktop check:shell assertion missed
  // it because the credit fits on one line there.
  if (size.w < 900) {
    const clearance = await page.evaluate(() => {
      const box = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
      };
      // The credit lives in MapLibre's bottom-right control; its INNER text box is what
      // wraps and grows, so that is the edge to clear, not the container.
      const attr = document.querySelector(".maplibregl-ctrl-attrib-inner") || document.querySelector(".maplibregl-ctrl-bottom-right");
      const a = attr ? attr.getBoundingClientRect() : null;
      return {
        attrTop: a ? Math.round(a.top) : null,
        attrLeft: a ? Math.round(a.left) : null,
        attrRight: a ? Math.round(a.right) : null,
        badge: box(".landsd-badge"),
        ctrl: box(".layer-control"),
      };
    });
    console.log(`attribution top=${clearance.attrTop}  landsd bottom=${clearance.badge && clearance.badge.bottom}  layer ctrl bottom=${clearance.ctrl && clearance.ctrl.bottom}`);
    if (clearance.attrTop !== null) {
      // A gap only means anything if the two boxes also overlap horizontally — the credit
      // is a full-width box here (x=10..380 at 390px), but assert it rather than assume it,
      // so a future layout that moves the credit to one side does not keep this rule alive
      // for no reason.
      const hits = (b) => b && b.bottom > clearance.attrTop - 6 && b.right > clearance.attrLeft && b.left < clearance.attrRight;
      if (hits(clearance.badge)) {
        problems.push(`${size.name}: the LandsD badge sits on the attribution line (badge bottom ${clearance.badge.bottom} vs attribution top ${clearance.attrTop})`);
      }
      if (hits(clearance.ctrl)) {
        problems.push(`${size.name}: the layer button sits on the attribution line (button bottom ${clearance.ctrl.bottom} vs attribution top ${clearance.attrTop})`);
      }
      // ...and the button must not be parked up in the sky either: it belongs in the
      // corner, so assert a ceiling on how far above the credit it may float.
      if (clearance.ctrl && clearance.attrTop - clearance.ctrl.bottom > 30) {
        problems.push(`${size.name}: the layer button floats ${clearance.attrTop - clearance.ctrl.bottom}px above the credit line — that is not the corner any more`);
      }
    }
  }

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
      // The band's top edge is where a phone's own browser chrome starts on a real device,
      // so "y >= 0" is not enough — the head needs real clearance below it or it is
      // invisible in practice.
      const band = document.querySelector("#mapWrap");
      const bandTop = band ? Math.round(band.getBoundingClientRect().top) : 0;
      const body = document.querySelector(".layer-control .lyr-body");
      return {
        headY: Math.round(hr.y),
        headH: Math.round(hr.height),
        ctrlTop: Math.round(cr.y),
        ctrlBottom: Math.round(cr.bottom),
        bandTop,
        bodyDisplay: body ? getComputedStyle(body).display : "missing",
      };
    });
    if (!expanded) {
      problems.push(`${size.name}: no .layer-control .lyr-head to expand`);
    } else {
      console.log(`expanded    head y=${expanded.headY} h=${expanded.headH}  band top=${expanded.bandTop}  control ${expanded.ctrlTop}..${expanded.ctrlBottom}  body=${expanded.bodyDisplay}`);
      if (expanded.bodyDisplay === "none") problems.push(`${size.name}: the head did not open the list`);
      const clear = expanded.headY - expanded.bandTop;
      if (clear < 32) {
        problems.push(`${size.name}: the CLOSE button ends up ${clear}px below the map band's top while the list is open — the map band is 46% of the screen and the browser chrome is right above it, so the reader cannot reach the control (head y=${expanded.headY}, band top=${expanded.bandTop})`);
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

  // THE ASSISTANT IS THE SECOND THING THAT UNFOLDS IN THE CORNER, and the same trap applies:
  // its head is the only way to close it, it is anchored to the bottom of a 46vh band, so a
  // height-based box puts the button off the top. It is anchored to both edges instead —
  // asserted here, last, because switching mode changes which panels are on screen.
  if (size.w < 900) {
    const assist = await page.evaluate(async () => {
      const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "drone"));
      if (!(sel instanceof HTMLSelectElement)) return null;
      sel.value = "drone";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1600));
      const head = document.querySelector(".drone-assist-head");
      if (!(head instanceof HTMLElement)) return { found: false };
      const beforeOpen = { visible: getComputedStyle(document.querySelector(".drone-assist")).display !== "none" };
      const hr = head.getBoundingClientRect();
      const bandEarly = document.querySelector("#mapWrap").getBoundingClientRect();
      const badgeEarly = document.querySelector(".landsd-badge").getBoundingClientRect();
      const closed = {
        headTop: Math.round(hr.top), headBottom: Math.round(hr.bottom),
        bandTop: Math.round(bandEarly.top), bandBottom: Math.round(bandEarly.bottom),
        aboveBadge: hr.bottom <= badgeEarly.top + 1,
        badgeTop: Math.round(badgeEarly.top),
      };
      head.click();
      await new Promise((r) => setTimeout(r, 2500));
      const band = document.querySelector("#mapWrap").getBoundingClientRect();
      const badge = document.querySelector(".landsd-badge").getBoundingClientRect();
      const panel = document.querySelector(".drone-assist-body").getBoundingClientRect();
      const f = document.querySelector(".drone-assist iframe");
      // The panel is a card in the corner, so the invariant is not where it sits but what it
      // does to the map's own labels: clear of them, or covering them whole. Never straddling.
      const overlaps = (a, b) => !(a.left >= b.right || a.right <= b.left || a.top >= b.bottom || a.bottom <= b.top);
      const covers = (a, b) => a.top <= b.top && a.left <= b.left && a.bottom >= b.bottom && a.right >= b.right;
      const straddles = (a, b) => overlaps(a, b) && !covers(a, b);
      const placard = document.querySelector(".mh-scope").getBoundingClientRect();
      const clock = document.querySelector(".mh-clock").getBoundingClientRect();
      // Measure the card BEFORE asking for the enlarged shape: a frame height read after the
      // dispatch is the enlarged one, and printing it beside the card's panel height reads as a
      // frame taller than the box it is in.
      const cardFrameH = f ? Math.round(f.getBoundingClientRect().height) : 0;
      // The frame's ⤢ asks for room. On a phone that can only come from height, so the
      // enlarged panel takes the band outright — assert it is taller and still never straddles.
      window.dispatchEvent(new MessageEvent("message", { data: { type: "sua:expand" }, origin: "https://sua-assistant.pages.dev" }));
      await new Promise((r) => setTimeout(r, 350));
      const big = document.querySelector(".drone-assist-body").getBoundingClientRect();
      return {
        found: true,
        visible: beforeOpen.visible,
        ...closed,
        panelTop: Math.round(panel.top), panelBottom: Math.round(panel.bottom),
        panelLeft: Math.round(panel.left), panelRight: Math.round(panel.right),
        bandLeft: Math.round(band.left), bandRight: Math.round(band.right),
        widthOfBand: +(panel.width / band.width).toFixed(2),
        bigHeight: Math.round(big.height), cardHeight: Math.round(panel.height),
        bigStraddles: straddles(big, placard) || straddles(big, clock),
        straddlesPlacard: straddles(panel, placard),
        straddlesClock: straddles(panel, clock),
        placardBottom: Math.round(placard.bottom),
        clockBottom: Math.round(clock.bottom),
        badgeBelow: badge.top >= panel.bottom - 2,
        frameH: cardFrameH,
      };
    });
    if (!assist || !assist.found) {
      problems.push(`${size.name}: the drone assistant button is missing`);
    } else {
      console.log(`assistant   closed: button ${assist.headTop}..${assist.headBottom} in band ${assist.bandTop}..${assist.bandBottom} (badge top ${assist.badgeTop})`);
      console.log(`            open: panel ${assist.panelTop}..${assist.panelBottom} x ${assist.panelLeft}..${assist.panelRight} in band x ${assist.bandLeft}..${assist.bandRight}  frame ${assist.frameH}px`);
      console.log(`            placard bottom ${assist.placardBottom}  clock bottom ${assist.clockBottom}  enlarged ${assist.bigHeight}px tall`);
      if (!assist.visible) problems.push(`${size.name}: the drone assistant did not appear in drone mode`);
      if (assist.headTop < assist.bandTop) problems.push(`${size.name}: the assistant's button is above the map band (button top ${assist.headTop} vs band top ${assist.bandTop}) — it is the only way to close it`);
      if (!assist.aboveBadge) problems.push(`${size.name}: the assistant button overlaps the LandsD notice (button bottom ${assist.headBottom} vs notice top ${assist.badgeTop})`);
      if (assist.panelTop < assist.bandTop) problems.push(`${size.name}: the open assistant is above the map band (panel top ${assist.panelTop} vs band top ${assist.bandTop})`);
      if (assist.straddlesPlacard) problems.push(`${size.name}: the open assistant half-covers the map placard (panel top ${assist.panelTop}, placard bottom ${assist.placardBottom}) — move it clear or cover it whole`);
      if (assist.straddlesClock) problems.push(`${size.name}: the open assistant half-covers the clock — move it clear or cover it whole`);
      if (assist.widthOfBand > 0.88) problems.push(`${size.name}: the open assistant is nearly as wide as the band (${assist.widthOfBand} of it) — it reads as cramped, and a strip of map should show beside it`);
      if (!assist.badgeBelow) problems.push(`${size.name}: the open assistant hides the LandsD credit (panel bottom ${assist.panelBottom} vs notice top ${assist.badgeTop})`);
      // 70px is a message and a composer, no more. A phone that cannot give the card that much
      // still has the frame's own ⤢, which takes the whole band — asserted below to be worth
      // taking, so the two states cannot converge into the same cramped box.
      if (assist.frameH < 70) problems.push(`${size.name}: the assistant frame has no usable height (${assist.frameH}px)`);
      // A frame taller than its own panel is clipped by overflow:hidden: the reader sees the top
      // of the chat and never the input box, with nothing in the console to say so.
      if (assist.frameH > assist.panelBottom - assist.panelTop + 2) problems.push(`${size.name}: the assistant frame overflows the panel it sits in (frame ${assist.frameH}px vs panel ${assist.panelBottom - assist.panelTop}px)`);
      if (!(assist.bigHeight >= assist.cardHeight * 1.25 && assist.bigHeight >= 110)) problems.push(`${size.name}: the ⤢ in the frame barely enlarges the panel (${assist.cardHeight} → ${assist.bigHeight}px) — it has to be worth taking`);
      if (assist.bigStraddles) problems.push(`${size.name}: the enlarged panel half-covers a label (${assist.bigHeight}px tall)`);
    }
    await page.evaluate(async () => {
      const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "overview"));
      if (sel instanceof HTMLSelectElement) {
        sel.value = "overview";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      await new Promise((r) => setTimeout(r, 600));
    });
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
