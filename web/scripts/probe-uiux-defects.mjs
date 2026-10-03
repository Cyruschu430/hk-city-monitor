// probe-uiux-defects.mjs — objective UI/UX defects, measured.
//
// "Make it look nice and professional" is not directly assertable, but most of
// what MAKES it look unprofessional is: clipped text, elements overflowing their
// containers, content cut off by overflow:hidden, type below a legible size,
// tap targets too small to hit, and content that spills under the status bar.
// Those are all measurements, so they are what this probe reports.
//
// It is deliberately NOT a screenshot review — a screenshot has been recorded
// calling a two-column grid single-column and a fixed build still broken.
import { chromium } from "playwright-core";

const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const url = process.argv[2] ?? "http://localhost:4173/";
const browser = await chromium.launch({ executablePath: exe, headless: true });

const report = async (label, width, height) => {
  const page = await browser.newPage({ viewport: { width, height }, locale: "zh-HK" });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
  // The app auto-hoists 停水模式 when drinking water is out, which leaves ONE
  // panel — and then every density number measures that mode, not the default
  // view. MEASURED: the first run of this probe reported columnScreens=1 and
  // "1/1 panels" on a 1600x1000 desktop because of exactly this. Force 總覽.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("#rail .rail-btn")].find((x) =>
      (x.querySelector(".tip")?.textContent ?? "").includes("總覽"),
    );
    b?.click();
  });
  await page.waitForTimeout(4000);
  await page
    .waitForFunction(
      () => {
        const ps = [...document.querySelectorAll(".panel[data-state]")];
        return ps.length > 0 && ps.every((p) => p.dataset.state !== "loading");
      },
      null,
      { timeout: 60_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(3000);

  const out = await page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== "none";
    };
    const idOf = (el) => {
      const p = el.closest("[data-panel]");
      return (p ? `panel:${p.dataset.panel}` : "chrome") + " " + (el.className || el.tagName).toString().split(" ")[0];
    };

    // 1. Clipped text: the element has more content than it can show.
    const clipped = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!vis(el) || el.children.length > 0) continue;
      const t = (el.textContent ?? "").trim();
      if (!t) continue;
      const cs = getComputedStyle(el);
      const clipsX = el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(cs.overflowX);
      const clipsY = el.scrollHeight > el.clientHeight + 1 && /hidden|clip/.test(cs.overflowY);
      if (clipsX || clipsY) clipped.push({ where: idOf(el), text: t.slice(0, 42), dx: el.scrollWidth - el.clientWidth, dy: el.scrollHeight - el.clientHeight });
    }

    // 2. Children escaping their parent box (right or bottom edge).
    const escaping = [];
    for (const el of document.querySelectorAll("#panels *, #statusbar *, .map-hud *, header *")) {
      if (!vis(el)) continue;
      const p = el.parentElement;
      if (!p || !vis(p)) continue;
      const a = el.getBoundingClientRect();
      const b = p.getBoundingClientRect();
      const dx = Math.round(a.right - b.right);
      const dy = Math.round(a.bottom - b.bottom);
      if (dx > 2 || dy > 2) {
        const pcs = getComputedStyle(p);
        if (/hidden|clip|auto|scroll/.test(pcs.overflowX + pcs.overflowY)) continue; // intended scroller
        escaping.push({ where: idOf(el), dx, dy });
      }
    }

    // 3. Type below 9px — below this the app is unreadable on a normal display.
    const tiny = [...document.querySelectorAll("body *")]
      .filter(vis)
      .filter((el) => el.children.length === 0 && (el.textContent ?? "").trim())
      .map((el) => ({
        where: idOf(el),
        px: parseFloat(getComputedStyle(el).fontSize),
        text: (el.textContent ?? "").trim().slice(0, 30),
      }))
      .filter((x) => x.px < 9);

    // 4. Tap targets below 24px (the WCAG 2.2 minimum is 24x24).
    const small = [...document.querySelectorAll("button, a, [role='switch']")]
      .filter(vis)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { where: idOf(el), w: Math.round(r.width), h: Math.round(r.height), label: (el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 22) };
      })
      .filter((x) => x.w < 24 || x.h < 24);

    // 5. Content hidden under the status bar / panel column edges.
    const sb = document.querySelector("#statusbar");
    const sbTop = sb ? sb.getBoundingClientRect().top : Infinity;
    const under = [...document.querySelectorAll("#panels .panel")]
      .filter(vis)
      .filter((p) => {
        const r = p.getBoundingClientRect();
        return r.bottom > sbTop + 1 && r.top < sbTop;
      })
      .map((p) => p.dataset.panel);

    const col = document.querySelector("#panels");
    const shown = [...document.querySelectorAll(".panel[data-panel]")].filter(vis);
    const firstPaint = shown.filter((p) => p.getBoundingClientRect().top < (col?.clientHeight ?? 0)).length;

    return {
      clipped,
      escaping,
      tiny,
      small,
      underStatusBar: under,
      columnScreens: col ? +(col.scrollHeight / col.clientHeight).toFixed(2) : null,
      panelsVisibleWithoutScroll: firstPaint,
      panelsTotal: shown.length,
    };
  });

  console.log(`\n===== ${label} (${width}x${height}) =====`);
  console.log(`columnScreens=${out.columnScreens} · panels in first screen=${out.panelsVisibleWithoutScroll}/${out.panelsTotal}`);
  const dump = (name, arr, fmt) => {
    console.log(`${name}: ${arr.length}`);
    for (const x of arr.slice(0, 12)) console.log("   " + fmt(x));
    if (arr.length > 12) console.log(`   … +${arr.length - 12} more`);
  };
  dump("clipped text", out.clipped, (x) => `${x.where}  "${x.text}"  -${x.dx}x/${x.dy}y`);
  dump("children escaping parent", out.escaping, (x) => `${x.where}  +${x.dx}x/+${x.dy}y`);
  dump("type < 9px", out.tiny, (x) => `${x.where}  ${x.px}px  "${x.text}"`);
  dump("tap targets < 24px", out.small, (x) => `${x.where}  ${x.w}x${x.h}  "${x.label}"`);
  dump("panels under the status bar", out.underStatusBar, (x) => x);
  await page.close();
};

await report("desktop", 1600, 1000);
await report("laptop", 1366, 768);
await report("mobile", 390, 844);

await browser.close();
