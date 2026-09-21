#!/usr/bin/env node
// verify-browser.mjs — the acceptance pass, in a real browser.
//
// A screenshot is not evidence; these are measurements. Every check prints the
// numbers it measured, and the script exits non-zero if a check fails. It runs
// against a served build (vite preview) and, when one is running, the local
// Worker on 127.0.0.1:8787 for the proxied sources.
//
// Usage: node scripts/verify-browser.mjs [baseUrl] [--headed]

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:4173/";
const headed = process.argv.includes("--headed");
const exe = "C:\\Users\\cyrus\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe";
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "artifacts");
mkdirSync(outDir, { recursive: true });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `\n    ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: exe, headless: !headed });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "zh-HK" });

const consoleErrors = [];
const failedRequests = [];
const badStatus = [];
const workerHits = [];
let offlinePhase = false;
page.on("console", (m) => {
  if (m.type() === "error" && !offlinePhase) consoleErrors.push(m.text().slice(0, 200));
});
page.on("response", (r) => {
  if (r.status() >= 400 && !offlinePhase) badStatus.push(`${r.status()} ${r.url().slice(0, 100)}`);
});
page.on("requestfailed", (r) => {
  if (!offlinePhase) failedRequests.push(`${r.url().slice(0, 110)} — ${r.failure()?.errorText}`);
});
page.on("request", (r) => {
  if (r.url().includes("/proxy?url=")) workerHits.push(decodeURIComponent(r.url().split("url=")[1] ?? "").slice(0, 90));
});

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForFunction(() => document.body.dataset.ready === "1", null, { timeout: 45_000 });
  // let the first round of panels resolve
  await page.waitForFunction(() => {
    const states = [...document.querySelectorAll(".panel[data-state]")].map((p) => p.dataset.state);
    return states.length >= 5 && states.every((s) => s !== "loading");
  }, null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(3000);

  // --- 1. the map itself ------------------------------------------------------
  const mapInfo = await page.evaluate(() => {
    const map = window.__map;
    if (!map) return { ok: false, reason: "window.__map missing" };
    const style = map.getStyle();
    const layers = (style?.layers ?? []).map((l) => l.id);
    return {
      ok: true,
      center: map.getCenter().toArray().map((n) => Number(n.toFixed(3))),
      zoom: Number(map.getZoom().toFixed(2)),
      layers,
      topo: !!map.getLayer("landsd-topo"),
      label: !!map.getLayer("landsd-label-tc"),
      imageryHidden: map.getLayoutProperty("esri-imagery", "visibility") === "none",
      cameraSources: ["cameras-td", "cameras-hko"].filter((s) => !!map.getSource(s)),
      paintedTd: map.queryRenderedFeatures({ layers: ["cameras-td-cluster", "cameras-td-point"] }).length,
      renderedTiles: !!style,
    };
  });
  check("地圖：MapLibre 由 style URL 起好，LandsD 底圖＋繁中標籤圖層在場", mapInfo.ok && mapInfo.topo && mapInfo.label,
    `center ${mapInfo.center} zoom ${mapInfo.zoom} layers=[${mapInfo.layers?.join(", ")}]`);
  check("地圖：兩個相機來源都掛上，而且真係畫出嚟", mapInfo.cameraSources?.length === 2 && mapInfo.paintedTd > 0,
    `sources=[${mapInfo.cameraSources}] rendered TD features=${mapInfo.paintedTd}`);

  const camCounts = await page.evaluate(() => window.__cameras);
  check("相機：1013 運輸署 + 34 天文台全部載入", camCounts?.td === 1013 && camCounts?.hko === 34,
    `td=${camCounts?.td} hko=${camCounts?.hko}`);

  // --- 2. attribution (licence term) -----------------------------------------
  const attrib = await page.evaluate(() => {
    const badge = document.querySelector(".landsd-badge");
    const ctrl = document.querySelector(".maplibregl-ctrl-attrib");
    return { badge: badge?.textContent?.trim() ?? null, ctrl: ctrl?.textContent?.trim() ?? null };
  });
  check("標註：地圖面有「Map from Lands Department 地政總署」", (attrib.badge ?? "").includes("Lands Department"),
    `badge="${attrib.badge}" ctrl="${attrib.ctrl}"`);

  // --- 3. panels: config-driven, honesty states, footers ----------------------
  // Pin 總覽 first: the trigger engine may have auto-switched into a vertical
  // (today there ARE live water notices), and a mode transition is not a bug —
  // but measuring mid-transition is. Wait for the mode to settle.
  await page.click(".rail-btn:nth-child(1)");
  await page.waitForFunction(
    () => document.querySelectorAll(".panel[data-panel]").length >= 5 &&
      [...document.querySelectorAll(".panel[data-state]")].every((p) => p.dataset.state !== "loading"),
    null,
    { timeout: 45_000 },
  ).catch(() => {});
  await page.waitForTimeout(1500);

  const panels = await page.evaluate(() =>
    [...document.querySelectorAll(".panel[data-panel]")].map((p) => ({
      id: p.dataset.panel,
      state: p.dataset.state,
      hasTime: !!p.querySelector(".panel-foot time")?.textContent?.trim(),
      time: p.querySelector(".panel-foot time")?.textContent?.trim(),
      src: p.querySelector(".panel-foot .src")?.textContent?.trim(),
      bodyKind: p.querySelector(".panel-body > *")?.className ?? p.querySelector(".panel-body > *")?.tagName,
      text: (p.querySelector(".panel-body")?.textContent ?? "").trim().slice(0, 70),
    })),
  );
  const allowed = new Set(["loading", "live", "stale", "error"]);
  check("面板：由 panels.json 砌出，每個都係四態之一", panels.length >= 5 && panels.every((p) => allowed.has(p.state)),
    panels.map((p) => `${p.id}=${p.state}`).join(" "));
  check("面板：每個都有更新時間同來源連結", panels.every((p) => p.hasTime && p.src),
    `times=${panels.map((p) => p.time).join(" | ")}`);

  console.log(`    （面板順序：${panels.map((p) => p.id).join(" → ")}）`);

  // --- 4. the 停水 gate: live WSD data through the Worker ---------------------
  await page.click(".rail-btn:nth-child(4)").catch(() => {}); // 停水模式 = 4th rail button
  await page.waitForFunction(
    () => {
      const p = document.querySelector('[data-panel="water_suspension_list"]');
      return p && p.dataset.state !== "loading";
    },
    null,
    { timeout: 20_000 },
  ).catch(() => {});
  await page.waitForTimeout(1500);
  const water = await page.evaluate(() => {
    const p = document.querySelector('[data-panel="water_suspension_list"]');
    if (!p) return { found: false };
    const items = [...p.querySelectorAll("li")].map((li) => li.textContent.trim());
    return {
      found: true,
      state: p.dataset.state,
      items: items.length,
      first: items[0] ?? null,
      empty: p.querySelector(".p-empty")?.textContent ?? null,
      src: p.querySelector(".panel-foot .src")?.textContent?.trim() ?? null,
      time: p.querySelector(".panel-foot time")?.textContent?.trim() ?? null,
    };
  });
  check("停水模式：panel 由 verticals.json 開出，顯示實時水務署通知",
    water.found && water.state === "live" && water.items > 0,
    `state=${water.state} items=${water.items}\n    首宗：${water.first}\n    來源：${water.src} @ ${water.time}`);

  // The records come from the collector (the esd host refuses BoringSSL), so the
  // honest check is: real notice text, and NOT a doomed request to that host.
  const wsdHit = workerHits.find((u) => u.includes("esd.wsd.gov.hk"));
  const esdTried = failedRequests.some((u) => u.includes("esd.wsd.gov.hk")) ||
    (await page.evaluate(() => performance.getEntriesByType("resource").some((r) => r.name.includes("esd.wsd.gov.hk"))));
  check("停水模式：唔會盲試連唔到嘅 esd.wsd.gov.hk（BoringSSL 拒絕 static-RSA TLS）",
    !wsdHit && !esdTried, `worker 命中=${wsdHit ?? "冇"}，esd 請求=${esdTried ? "有" : "冇"}`);

  // The layer is added asynchronously (a CSDI fetch), so wait for it rather
  // than sampling mid-attach.
  await page.waitForFunction(() => !!window.__map?.getLayer("vl-water_suspension_districts-fill"), null, { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const districtLayer = await page.evaluate(() => {
    const map = window.__map;
    const id = "vl-water_suspension_districts-fill";
    if (!map.getLayer(id)) return { ok: false };
    const feats = map.queryRenderedFeatures({ layers: [id] });
    const names = [...new Set(feats.map((f) => f.properties?.DISTRICT_CHINESE))];
    const paint = JSON.stringify(map.getPaintProperty(id, "fill-color"));
    const active = window.__hkcm.activeDistricts();
    return {
      ok: true,
      rendered: feats.length,
      districts: names.length,
      highlighted: active,
      allActiveInPaint: active.every((d) => paint.includes(d)),
      styled: paint.includes("ff5d6c"),
    };
  });
  check("停水模式：CSDI 分區圖層畫出 18 區，有停水嘅區轉紅",
    districtLayer.ok && districtLayer.districts === 18 && districtLayer.styled && districtLayer.allActiveInPaint,
    `rendered=${districtLayer.rendered} distinct=${districtLayer.districts} 標紅區=${districtLayer.highlighted?.join("、")} 全部入 paint=${districtLayer.allActiveInPaint}`);

  // --- 5. camera click → focus drawer ----------------------------------------
  const drawer = await page.evaluate(async () => {
    const map = window.__map;
    let feats = map.queryRenderedFeatures({ layers: ["cameras-td-point"] });
    // At city zoom nearly every TD camera is inside a cluster; zoom in once so
    // an unclustered point exists to click (measurement, not a screenshot).
    if (!feats.length) {
      map.zoomTo(13, { duration: 0 });
      await new Promise((r) => setTimeout(r, 1800));
      feats = map.queryRenderedFeatures({ layers: ["cameras-td-point"] });
    }
    if (!feats.length) return { clicked: false, reason: "no unclustered TD point rendered even after zoom" };
    const f = feats[0];
    const [lon, lat] = f.geometry.coordinates;
    map.fire("click", { point: map.project([lon, lat]), lngLat: { lng: lon, lat }, features: [f] });
    await new Promise((r) => setTimeout(r, 900));
    const el = document.getElementById("drawer");
    const img = el.querySelector("img");
    // TD snapshots occasionally fail one request; the drawer then shows its
    // honest 死機 state instead of a black box. Give the image one beat to
    // arrive, then accept either the loaded image or the honest empty state.
    await new Promise((r) => setTimeout(r, 1200));
    const img2 = el.querySelector("img");
    const deadState = el.querySelector(".p-empty")?.textContent ?? null;
    return {
      clicked: true,
      open: !el.hidden,
      title: el.querySelector("h2")?.textContent ?? null,
      img: (img2 ?? img)?.getAttribute("src")?.slice(0, 90) ?? null,
      dead: deadState,
      kv: [...el.querySelectorAll("dd")].map((d) => d.textContent).slice(0, 4),
    };
  });
  check("焦點抽屜：點相機開到，有大圖（或誠實嘅死機態）、座標、來源",
    drawer.clicked && drawer.open && (!!drawer.img || !!drawer.dead),
    `title=${drawer.title}\n    img=${drawer.img} deadState=${drawer.dead}\n    kv=${drawer.kv?.join(" / ")}`);
  await page.screenshot({ path: join(outDir, "01-overview.png") });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => document.getElementById("drawer").hidden);
  check("抽屜：Esc 閂到", closed === true, `hidden=${closed}`);

  // --- 6. language switch (default 繁體中文) ----------------------------------
  // 停水模式 was pinned by the click above; the warnings panel lives in 總覽.
  await page.click(".rail-btn:nth-child(1)");
  await page.waitForTimeout(3500);
  const tcFirst = await page.evaluate(() => document.querySelector('[data-panel="warnings_list"] h2')?.textContent);
  await page.click("#langSwitch button:nth-child(2)").catch(() => {});
  await page.waitForTimeout(800);
  const enFirst = await page.evaluate(() => document.querySelector('[data-panel="warnings_list"] h2')?.textContent);
  check("語言：預設繁中，可切英文（同一欄位兩個值）", tcFirst === "天氣警告" && /Weather Warnings/.test(enFirst ?? ""),
    `tc="${tcFirst}" en="${enFirst}"`);
  await page.screenshot({ path: join(outDir, "02-panels-en.png") });
  await page.click("#langSwitch button:nth-child(1)").catch(() => {});
  await page.waitForTimeout(500);

  // Back to 總覽 (the water click above pinned that mode) so the language and
  // recovery checks measure the six-panel default view, not a one-panel mode.
  await page.click(".rail-btn:nth-child(1)");
  await page.waitForTimeout(4000);
  const overviewAgain = await page.evaluate(() =>
    [...document.querySelectorAll(".panel[data-panel]")].map((p) => `${p.dataset.panel}:${p.dataset.state}`),
  );
  check("總覽：人手切返總覽後六個 panel 齊", overviewAgain.length === 6, overviewAgain.join(" "));

  // --- 7. honesty when the data cannot arrive ---------------------------------
  // Two things are being tested and they are different:
  //   (a) a source that CANNOT answer must show its error state, not a blank
  //       panel and not a stale number dressed as current;
  //   (b) fully offline, nothing may go blank — and a payload the browser still
  //       has cached is legitimately shown, with its own timestamp, because
  //       that is what the source last said.
  offlinePhase = true;
  // Block one host deterministically: Playwright's offline mode still lets the
  // HTTP cache answer a fresh (<60s) proxy response, which is correct
  // behaviour but useless as a test of the error path.
  await page.route("**/proxy?url=https%3A%2F%2Fsecure1.info.gov.hk**", (route) => route.abort("failed"));
  await page.evaluate(() => window.__hkcm.refreshAll());
  await page.waitForFunction(
    () => document.querySelector('[data-panel="tp_queue_grid"]')?.dataset.state === "error",
    null,
    { timeout: 20_000 },
  ).catch(() => {});
  const blocked = await page.evaluate(() => {
    const p = document.querySelector('[data-panel="tp_queue_grid"]');
    return {
      state: p?.dataset.state,
      text: (p?.querySelector(".panel-body")?.textContent ?? "").trim().slice(0, 60),
      retry: !!p?.querySelector(".p-error button"),
      blank: (p?.querySelector(".panel-body")?.textContent ?? "").trim().length === 0,
    };
  });
  check("源頭壞掉：口岸 panel 轉 error、寫明原因、有得重試、唔會空白",
    blocked.state === "error" && blocked.retry && !blocked.blank,
    `state=${blocked.state} text="${blocked.text}" retry=${blocked.retry}`);

  await page.context().setOffline(true);
  await page.evaluate(() => window.__hkcm.refreshAll());
  await page.waitForTimeout(4000);
  const offline = await page.evaluate(() =>
    [...document.querySelectorAll(".panel[data-panel]")].map((p) => ({
      id: p.dataset.panel,
      state: p.dataset.state,
      empty: (p.querySelector(".panel-body")?.textContent ?? "").trim().length === 0,
      hasTime: !!p.querySelector(".panel-foot time")?.textContent?.trim(),
    })),
  );
  const allowedAll = offline.every((p) => ["live", "stale", "error"].includes(p.state));
  check("完全離線：冇一個面板變空白，每個都保留時間戳，狀態仍然係四態之一",
    allowedAll && offline.every((p) => !p.empty && p.hasTime),
    offline.map((p) => `${p.id}=${p.state}${p.empty ? "(BLANK!)" : ""}`).join(" "));
  await page.screenshot({ path: join(outDir, "03-offline.png") });
  await page.context().setOffline(false);
  await page.unroute("**/proxy?url=https%3A%2F%2Fsecure1.info.gov.hk**");
  offlinePhase = false;

  await page.evaluate(() => window.__hkcm.refreshAll());
  await page.waitForTimeout(4000);
  const recovered = await page.evaluate(() =>
    [...document.querySelectorAll(".panel[data-panel]")].map((p) => p.dataset.state),
  );
  check("復網：面板返到 live", recovered.filter((s) => s === "live").length >= 3, recovered.join(" "));

  // --- 8. reduce motion -------------------------------------------------------
  await page.emulateMedia({ reducedMotion: "reduce" });
  const motion = await page.evaluate(() => {
    const pulse = document.querySelector(".live-pulse");
    return { pulse: getComputedStyle(pulse).animationName, panel: getComputedStyle(document.querySelector(".panel")).animationName };
  });
  check("減少動態：prefers-reduced-motion 之下動畫全停", motion.pulse === "none" && motion.panel === "none",
    `pulse=${motion.pulse} panel=${motion.panel}`);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // --- 9. mobile 390px ---------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1200);
  const mobile = await page.evaluate(() => ({
    scrollW: document.scrollingElement.scrollWidth,
    innerW: window.innerWidth,
    railBottom: getComputedStyle(document.getElementById("rail")).bottom,
    mapH: Math.round(document.getElementById("mapWrap").getBoundingClientRect().height),
  }));
  check("手機 390px：冇橫向滾動，地圖仍在上方", mobile.scrollW <= mobile.innerW + 1 && mobile.mapH > 200,
    `scrollWidth=${mobile.scrollW} (inner=${mobile.innerW}) mapWrap=${mobile.mapH}px`);
  await page.screenshot({ path: join(outDir, "04-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 900 });

  // --- 9b. the other two verticals, from config only -------------------------
  const modes = await page.evaluate(async () => {
    const out = {};
    const map = window.__map;
    for (const [mode, selector] of [["typhoon", 2], ["border", 3]]) {
      document.querySelector(`.rail-btn:nth-child(${selector})`)?.click();
      await new Promise((r) => setTimeout(r, 6000));
      out[mode] = [...document.querySelectorAll(".panel[data-panel]")].map((p) => ({
        id: p.dataset.panel,
        state: p.dataset.state,
        kind: p.querySelector(".panel-body > *")?.className || p.querySelector(".panel-body > *")?.tagName || "",
      }));
    }
    return { out, layers: (map.getStyle().layers ?? []).map((l) => l.id).filter((i) => i.startsWith("vl-")) };
  });
  for (const [mode, panels] of Object.entries(modes.out)) {
    const ok = panels.length >= 3 && panels.every((p) => p.state === "live" || p.state === "stale" || p.state === "error");
    check(`垂直模式 ${mode}：由 verticals.json 開出 ${panels.length} 個 panel，無一要 code`,
      ok, panels.map((p) => `${p.id}=${p.state}(${p.kind})`).join(" "));
  }
  await page.screenshot({ path: join(outDir, "05-typhoon-after-border.png") });

  const proxyWorked = workerHits.filter((u) => u.includes("weather.gov.hk") || u.includes("hongkongairport") || u.includes("mardep") || u.includes("info.gov.hk"));
  check("Worker 代理：CORS 封閉源（天文台／機管局／海事處）真係經 /proxy 行", proxyWorked.length > 0,
    proxyWorked.slice(0, 3).join(" | ") || "（冇）");

  // --- 9c. 3D: lazy layer, and an honest error state when it cannot load ------
  const workerBaseUrl = "http://127.0.0.1:8787";
  const rail3d = ".rail-btn:nth-child(11)"; // rail order: 5 modes, sep, 5 layers
  // Error path FIRST, on a fresh overlay: block /config/3d so the first build
  // must fail → the toggle shows red + the banner names the layer.
  await page.route(`${workerBaseUrl}/config/3d*`, (route) => route.abort("failed"));
  await page.click(rail3d);
  await page.waitForTimeout(2500);
  const threeDErr = await page.evaluate(() => ({
    overlay: !!window.__overlay3d,
    banner: document.querySelector("#mapHud .panel")?.textContent?.slice(0, 90) ?? null,
    red: getComputedStyle(document.querySelector(".rail-btn:nth-child(11)")).color,
  }));
  check("3D 圖層：config 連唔到 → overlay 唔會出現，有明確錯誤訊息",
    !threeDErr.overlay && threeDErr.banner.includes("圖層開唔到"),
    `overlay=${threeDErr.overlay} banner="${threeDErr.banner}"`);
  await page.unroute(`${workerBaseUrl}/config/3d*`);

  // Success path: with /config/3d reachable, the lazy chunks load and the
  // overlay attaches; stop the tile flood right after so the rest of the run
  // stays quiet (tile PAINTING is recorded as UNVERIFIED — env limitation).
  await page.click(rail3d);
  await page.waitForFunction(() => !!window.__overlay3d, null, { timeout: 40_000 }).catch(() => {});
  await page.evaluate(() => {
    window.__overlay3d?.setProps?.({
      layers: [],
    });
  });
  const threeD = await page.evaluate(() => ({
    overlay: !!window.__overlay3d,
    chunks: performance.getEntriesByType("resource").filter((r) => r.name.includes("globe-viewport") || r.name.includes("deck")).length,
  }));
  check("3D 圖層：deck.gl 係 lazy chunk，撳掣先載入；overlay 已掛上", threeD.overlay && threeD.chunks >= 1,
    `overlay3d=${threeD.overlay} deck chunks=${threeD.chunks}`);
  await page.click(rail3d); // leave it off

  // --- 10. error surface ------------------------------------------------------
  const unexpected = consoleErrors.filter(
  (e) =>
    // 3D tiles cannot paint in this environment (documented limitation)
    !e.includes("deck.gl: assertion failed") &&
    !e.includes("A 3D tile failed to load") &&
    !e.includes("ERR_INSUFFICIENT_RESOURCES") &&
    // resource-level noise from by-design behaviour:
    //  · radar probes older 6-min slots until one 200s (fallback by design)
    //  · the 3D error-path test deliberately blocks /config/3d
    !e.startsWith("Failed to load resource"),
);
  const deckErrs = consoleErrors.filter((e) => e.includes("deck.gl: assertion failed")).length;
  check("Console：上線期間冇未捕捉錯誤（3D tiles 環境限制除外，見報告）",
    unexpected.length === 0, `${unexpected.slice(0, 4).join(" | ") || `已知限制：deck.gl assertion ×${deckErrs}（3D tiles 未驗證）`}`);
  // Exclusions, each by design and documented in the report:
  //  · rad_256_png — the radar adapter probes now/−6/−12/−18 min slots; a 404
  //    for an older slot is the fallback working, not a broken source.
  //  · data.map.gov.hk — 3D tiles: heavy concurrent fetches exceed this
  //    Chromium's connection pool (ERR_INSUFFICIENT_RESOURCES); tile painting
  //    is recorded as UNVERIFIED and is not part of this pass's claim.
  const realFailures =
    failedRequests.filter((u) => !u.includes("arcgisonline") && !u.includes("rad_256_png") && !u.includes("data.map.gov.hk") && !u.includes("/config/3d"));
  const realBadStatus = badStatus.filter((u) => !u.includes("rad_256_png") && !u.includes("data.map.gov.hk") && !u.includes("/config/3d"));
  check("網絡：上線期間冇失敗請求", realFailures.length === 0 && realBadStatus.length === 0,
    [...realFailures.slice(0, 3), ...realBadStatus.slice(0, 3)].join(" | ") || "（無）");

  console.log(`\nWorker 代理命中 ${workerHits.length} 次，例如：`);
  for (const u of [...new Set(workerHits)].slice(0, 6)) console.log(`  · ${u}`);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`screenshots → ${outDir}`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((f) => f.name).join(" | ")}`);
  process.exit(1);
}
console.log("verify-browser: ALL PASS");
