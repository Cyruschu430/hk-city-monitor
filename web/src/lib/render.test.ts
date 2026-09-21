// render.test.ts — smoke test for the one renderer against a MINIMAL DOM stub.
// This is not a browser: it proves the structure (tags, classes, text, retry
// wiring) for all eight render types and all four honesty states. The visual
// proof is the browser pass in the final report — the two are different
// claims and both are made where they belong.

import assert from "node:assert/strict";

// --- minimal DOM stub: exactly the surface dom.ts/render.ts use --------------
class StubEl {
  tagName: string;
  attributes: Record<string, string> = {};
  childNodes: (StubEl | { text: string })[] = [];
  listeners: Record<string, ((e?: unknown) => void)[]> = {};
  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  setAttribute(k: string, v: string) {
    this.attributes[k] = String(v);
  }
  getAttribute(k: string) {
    return this.attributes[k];
  }
  append(...nodes: (StubEl | string)[]) {
    for (const n of nodes) this.childNodes.push(typeof n === "string" ? { text: n } : n);
  }
  addEventListener(type: string, fn: (e?: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  click() {
    for (const fn of this.listeners["click"] ?? []) fn();
  }
  get textContent(): string {
    return this.childNodes.map((c) => ("text" in c ? c.text : c.textContent)).join("");
  }
  walk(pred: (el: StubEl) => boolean): StubEl[] {
    const out: StubEl[] = [];
    const rec = (el: StubEl) => {
      if (pred(el)) out.push(el);
      for (const c of el.childNodes) if (c instanceof StubEl) rec(c);
    };
    rec(this);
    return out;
  }
  byClass(cls: string): StubEl[] {
    return this.walk((el) => (el.attributes["class"] ?? "").split(/\s+/).includes(cls));
  }
}

(globalThis as Record<string, unknown>)["localStorage"] = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
(globalThis as Record<string, unknown>)["document"] = {
  createElement: (tag: string) => new StubEl(tag),
  documentElement: { lang: "" },
};

const { renderPanel } = await import("./render.ts");
type PanelData = import("./render.ts").PanelData;
type PanelDef = import("./render.ts").PanelDef;
const { setLang } = await import("./i18n.ts");
const { live, errored, LOADING } = await import("./honesty.ts");

const def = (render: PanelDef["render"]): PanelDef => ({
  id: `p_${render}`,
  source: "test_source",
  render,
  title: { tc: "測試面板", en: "Test Panel" },
  cadence_note: { tc: "每 5 分鐘", en: "Every 5 minutes" },
});

const fixtures: Record<PanelDef["render"], PanelData> = {
  big_number: { kind: "big_number", value: "24.7", unit: "°C", sub: "天文台總部" },
  list: {
    kind: "list",
    items: [
      { title: "八號東南烈風或暴風信號", time: "2026-09-18 21:40", href: "https://example.hk/1" },
      { title: "黃色暴雨警告信號", time: "2026-09-18 20:15" },
    ],
  },
  table: {
    kind: "table",
    columns: ["時間", "航班", "來自", "狀態"],
    rows: [
      ["21:45", "CX840", "紐約", "抵達"],
      ["22:05", "KA711", "上海", "延誤"],
    ],
  },
  image_single: { kind: "image_single", src: "https://example.hk/radar.jpg", alt: "雷達圖", note: "每 6 分鐘" },
  image_wall: {
    kind: "image_wall",
    images: [
      { id: "H1", src: "https://example.hk/H1.jpg", name: "海底隧道" },
      { id: "H2", src: "https://example.hk/H2.jpg", name: "青馬大橋", dead: true },
    ],
  },
  raster_map: { kind: "raster_map", src: "https://example.hk/nowcast.png", alt: "降雨臨近預報" },
  gauge_grid: {
    kind: "gauge_grid",
    cells: [
      { label: "瑪麗醫院", value: "2 小時", level: "warn" },
      { label: "威爾斯親王醫院", value: "1 小時", level: "ok" },
    ],
  },
  status_grid: {
    kind: "status_grid",
    cells: [
      { label: "羅湖", value: "15 分鐘", status: 0 },
      { label: "落馬洲支線", value: "45 分鐘", status: 2 },
    ],
  },
};

// 1. All eight render types draw from fixtures.
for (const kind of Object.keys(fixtures) as PanelDef["render"][]) {
  const el = renderPanel(def(kind), fixtures[kind], live(new Date("2026-09-18T21:45:00+08:00")), {
    sourceName: "測試來源",
    sourceUrl: "https://example.hk/src",
  }) as unknown as StubEl;
  assert.equal(el.tagName, "SECTION", kind);
  assert.ok((el.getAttribute("class") ?? "").includes("panel"), kind);
  assert.equal(el.getAttribute("data-state"), "live", kind);
  assert.ok(el.textContent.includes("測試面板"), `${kind}: bilingual title rendered (tc default)`);
  assert.ok(el.byClass("panel-foot").length === 1, `${kind}: traceability footer present`);
  assert.ok(el.textContent.includes("測試來源"), `${kind}: source named in footer`);
}
console.log("✓ 8 種 render 全部由 fixtures 畫出（section.panel + footer）");

// structure spot-checks per type
const wall = renderPanel(def("image_wall"), fixtures["image_wall"], live(new Date())) as unknown as StubEl;
assert.equal(wall.byClass("cam").length, 2);
assert.equal(wall.byClass("cam")[1]!.getAttribute("class"), "cam dead", "dead camera is visibly dead");
const tbl = renderPanel(def("table"), fixtures["table"], live(new Date())) as unknown as StubEl;
assert.equal(tbl.byClass("ptable")[0]!.walk((e) => e.tagName === "TR").length, 3, "header + 2 rows");
const sg = renderPanel(def("status_grid"), fixtures["status_grid"], live(new Date())) as unknown as StubEl;
assert.equal(sg.byClass("status")[1]!.getAttribute("class"), "status s2", "紅黃綠 status class");
console.log("✓ 結構抽查：wall 2 格（1 死機）、table 3 行、status s2 紅色");

// 2. Four honesty states, each visibly distinct.
const load = renderPanel(def("list"), null, LOADING) as unknown as StubEl;
assert.ok(load.byClass("sk").length === 1, "loading → skeleton");
assert.equal(load.getAttribute("data-state"), "loading");

const hasClasses = (el: StubEl, ...cls: string[]) =>
  cls.every((c) => (el.getAttribute("class") ?? "").split(/\s+/).includes(c));

const lv = renderPanel(def("list"), fixtures["list"], live(new Date(Date.now() - 2 * 60_000))) as unknown as StubEl;
const liveChip = lv.walk((e) => hasClasses(e, "chip", "live"));
assert.ok(liveChip.length === 1, "live → live chip");
assert.ok(liveChip[0]!.textContent.includes("分鐘前"), "chip carries the age");

const st = renderPanel(def("list"), fixtures["list"], { state: "stale", updatedAt: new Date(Date.now() - 6 * 60_000) }) as unknown as StubEl;
assert.ok((st.getAttribute("class") ?? "").includes("is-stale"), "stale → amber border class");
const staleChip = st.walk((e) => hasClasses(e, "chip", "stale"));
assert.ok(staleChip[0]!.textContent.includes("數據 +6分鐘"), `stale chip names the lag, got: ${staleChip[0]!.textContent}`);
assert.ok(st.byClass("plist").length === 1, "stale still shows last-known data");

let retried = 0;
const er = renderPanel(def("list"), null, errored("HTTP 502"), { sourceName: "測試來源", onRetry: () => retried++ }) as unknown as StubEl;
assert.ok((er.getAttribute("class") ?? "").includes("is-error"), "error → red border class");
assert.ok(er.textContent.includes("未能讀取數據") && er.textContent.includes("HTTP 502"), "error names source + failure");
assert.equal(er.byClass("plist").length, 0, "error REPLACES content — no phantom list");
er.byClass("p-error")[0]!.walk((e) => e.tagName === "BUTTON")[0]!.click();
assert.equal(retried, 1, "重試 button is wired");
console.log("✓ 四態齊：loading skeleton / live chip / stale 數據+6分鐘 / error 替換內容＋重試");

// 3. Live-but-empty is honest, not a zero and not an error.
const empty = renderPanel(def("list"), { kind: "list", items: [] }, live(new Date()), {
  emptyText: { tc: "現時無生效警告", en: "No warnings in force" },
}) as unknown as StubEl;
assert.ok(empty.textContent.includes("現時無生效警告"), "empty state says so plainly");
assert.equal(empty.getAttribute("data-state"), "live", "empty is live, not error");
console.log("✓ 空數據出「現時無生效警告」，唔係空白唔係 0");

// 4. English switch re-renders language.
setLang("en");
const en = renderPanel(def("list"), fixtures["list"], live(new Date())) as unknown as StubEl;
assert.ok(en.textContent.includes("Test Panel"), "en switch renders en title");
assert.ok(en.textContent.includes("Every 5 minutes"), "en cadence note");
setLang("tc");
console.log("✓ 英文切換生效（title + cadence_note 同一欄位兩個值）");

// 5. Footer always shows the panel's own 更新時間.
const footEl = renderPanel(def("list"), fixtures["list"], live(new Date("2026-09-18T21:45:00+08:00"))) as unknown as StubEl;
const time = footEl.walk((e) => e.tagName === "TIME")[0]!;
assert.ok(time.textContent.includes("21:45"), `footer carries 更新時間, got: ${time.textContent}`);
console.log("✓ 每個 panel footer 有更新時間");

console.log("\nrender.test.ts: ALL PASS");
