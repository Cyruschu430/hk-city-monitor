// render.ts — PRIMITIVES §6: ONE renderer for all eight render types.
// Adding a ninth type is a spec change, not a coding decision; a vertical may
// never carry its own render code. Driven only by panels.json + the data the
// panel engine hands over.
//
// Honesty (DESIGN_BRIEF §6) is not optional decoration:
//   loading → skeleton that reserves height
//   live    → body + freshness chip
//   stale   → body + amber chip naming the lag; border degrades
//   error   → content REPLACED by one dim line naming the source and the
//             failure, plus 重試. Never a blank panel, never a fake value.
//   empty   → live fetch with zero records is NOT an error: it says so
//             plainly (「現時無生效警告」), because an empty box reads as broken.

import { h } from "./dom.ts";
import { t, lang, type L10n } from "./i18n.ts";
import { ageText, staleText, stamp } from "./format.ts";
import type { Honesty } from "./honesty.ts";

// --- data shapes the panel engine hands over --------------------------------

export interface ListItem {
  title: string;
  sub?: string; // secondary line (place, detail)
  time?: string; // mono timestamp line
  href?: string; // link back to the source (traceability rule)
  ok?: boolean; // informational line, no warning accent
}

export interface WallImage {
  id: string;
  src: string;
  name: string;
  fresh?: string; // freshness chip text
  dead?: boolean; // known-dead camera: honest wash + 暫時未能提供
  /** present when the tile is a live stream (YouTube etc.) */
  video?: { id: string; live: boolean; channel?: string };
}

export interface Gauge {
  label: string;
  value: string;
  level: "ok" | "warn" | "alert";
}

export interface StatusCell {
  label: string;
  value: string;
  /** 0 nominal, 1 elevated, 2 critical — mirrors the 綠/黃/紅 the sources publish */
  status: 0 | 1 | 2;
}

export type TableCell = string | { text: string; cls?: string };
export type PanelData =
  | { kind: "big_number"; value: string; unit?: string; sub?: string }
  | { kind: "list"; items: ListItem[] }
  | { kind: "table"; columns: string[]; rows: TableCell[][] }
  | { kind: "image_single"; src: string; alt: string; note?: string }
  | { kind: "image_wall"; images: WallImage[] }
  | { kind: "raster_map"; src: string; alt: string; legend?: string; empty?: boolean }
  | { kind: "gauge_grid"; cells: Gauge[] }
  | { kind: "status_grid"; cells: StatusCell[] };

export interface PanelDef {
  id: string;
  source: string;
  render: PanelData["kind"];
  title: L10n;
  params?: Record<string, unknown>;
  cadence_note: L10n;
}

export interface RenderOpts {
  /** source registry entry: name + link for the traceability footer */
  sourceName?: string;
  sourceUrl?: string;
  onRetry?: () => void;
  /** text for a live-but-empty panel, e.g. 現時無生效警告 */
  emptyText?: L10n;
  onImageClick?: (img: WallImage) => void;
}

const DEFAULT_EMPTY: L10n = { tc: "現時無相關資料", en: "Nothing to report right now" };

function chip(honesty: Honesty): HTMLElement {
  switch (honesty.state) {
    case "loading":
      return h("span", { class: "chip" }, lang() === "tc" ? "載入中…" : "loading…");
    case "live":
      return h(
        "span",
        { class: "chip live" },
        honesty.updatedAt ? ageText(honesty.updatedAt) : lang() === "tc" ? "即時" : "live",
      );
    case "stale":
      return h(
        "span",
        { class: "chip stale" },
        honesty.updatedAt ? staleText(honesty.updatedAt) : lang() === "tc" ? "已過期" : "stale",
      );
    case "error":
      return h("span", { class: "chip error" }, lang() === "tc" ? "未能更新" : "error");
  }
}

function skeleton(kind: PanelData["kind"]): HTMLElement {
  const bars = kind === "table" || kind === "list" ? 3 : 2;
  return h(
    "div",
    { class: "sk", "aria-hidden": "true" },
    ...Array.from({ length: bars }, () => h("i")),
  );
}

function emptyBox(text: L10n): HTMLElement {
  return h("div", { class: "p-empty" }, t(text));
}

function errorBox(note: string | undefined, sourceName: string | undefined, onRetry: (() => void) | undefined): HTMLElement {
  const where = sourceName ? `（${sourceName}）` : "";
  const msg =
    lang() === "tc"
      ? `未能讀取數據${where}${note ? `：${note}` : ""}`
      : `Could not load data${where ? ` (${sourceName})` : ""}${note ? `: ${note}` : ""}`;
  return h(
    "div",
    { class: "p-error" },
    h("span", {}, msg),
    onRetry ? h("button", { type: "button", onclick: onRetry }, lang() === "tc" ? "重試" : "Retry") : "",
  );
}

// --- the eight bodies --------------------------------------------------------

function body(data: PanelData, opts: RenderOpts): HTMLElement {
  switch (data.kind) {
    case "big_number":
      return h(
        "div",
        { class: "big" },
        h("b", {}, data.value),
        data.unit ? h("span", {}, data.unit) : "",
        data.sub ? h("span", { class: "sub" }, data.sub) : "",
      );

    case "list": {
      if (data.items.length === 0) return emptyBox(opts.emptyText ?? DEFAULT_EMPTY);
      return h(
        "ul",
        { class: "plist" },
        ...data.items.map((it) =>
          h(
            "li",
            it.ok ? { class: "ok-line" } : {},
            it.href ? h("a", { href: it.href, target: "_blank", rel: "noopener" }, it.title) : it.title,
            it.sub ? h("span", { class: "meta" }, it.sub) : "",
            it.time ? h("span", { class: "meta" }, it.time) : "",
          ),
        ),
      );
    }

    case "table": {
      if (data.rows.length === 0) return emptyBox(opts.emptyText ?? DEFAULT_EMPTY);
      const cell = (c: TableCell) => (typeof c === "string" ? h("td", {}, c) : h("td", c.cls ? { class: c.cls } : {}, c.text));
      return h(
        "table",
        { class: "ptable" },
        h("thead", {}, h("tr", {}, ...data.columns.map((c) => h("th", {}, c)))),
        h("tbody", {}, ...data.rows.map((r) => h("tr", {}, ...r.map(cell)))),
      );
    }

    case "image_single":
      return h(
        "figure",
        { class: "pimg", style: "margin:0" },
        h("img", { src: data.src, alt: data.alt, loading: "lazy" }),
        data.note ? h("figcaption", { class: "note" }, data.note) : "",
      );

    case "image_wall": {
      if (data.images.length === 0) return emptyBox(opts.emptyText ?? DEFAULT_EMPTY);
      return h(
        "div",
        { class: "wall" },
        ...data.images.map((img) => {
          // The <img> is built out and given its own error handler: a camera
          // that fails to load right now is NOT a live frame — degrade the
          // tile instead of leaving a broken-image box.
          const im = h("img", { src: img.src, alt: img.name, loading: "lazy" }) as HTMLImageElement;
          const tile = h(
            "div",
            {
              class: `cam${img.dead ? " dead" : ""}`,
              "data-dead": lang() === "tc" ? "暫時未能提供" : "temporarily unavailable",
              role: "button",
              tabindex: "0",
              onclick: () => opts.onImageClick?.(img),
            },
            im,
            h("span", { class: "lab" }, `${img.name}${img.video?.channel ? ` · ${img.video.channel}` : ""}`),
            img.fresh ? h("span", { class: "fresh chip" }, img.fresh) : "",
            img.video
              ? img.video.live
                ? h("span", { class: "fresh chip live", style: "background:rgba(255,93,108,.9);color:#fff" }, "LIVE 直播")
                : h("span", { class: "fresh chip" }, lang() === "tc" ? "現時無直播" : "not live now")
              : "",
          );
          im.addEventListener("error", () => {
            if (!tile.getAttribute("class")?.includes("dead")) tile.setAttribute("class", "cam dead");
          });
          return tile;
        }),
      );
    }

    case "raster_map":
      // The map overlay itself is a layer concern; the panel shows the source
      // frame as a preview so the column stays honest when the map is hidden.
      if (data.empty) {
        return h(
          "div",
          { class: "praster-empty" },
          h(
            "p",
            { class: "p-empty" },
            lang() === "tc" ? "現時無降雨（格網降雨量 ~0 mm）" : "No rainfall in the grid (~0 mm)",
          ),
          data.legend ? h("p", { class: "praster-legend" }, data.legend) : "",
        );
      }
      return h(
        "figure",
        { class: "pimg", style: "margin:0" },
        h("img", { class: "praster", src: data.src, alt: data.alt, loading: "lazy" }),
        data.legend ? h("figcaption", { class: "note" }, data.legend) : "",
      );

    case "gauge_grid": {
      if (data.cells.length === 0) return emptyBox(opts.emptyText ?? DEFAULT_EMPTY);
      return h(
        "div",
        { class: "gauges" },
        ...data.cells.map((g) =>
          h(
            "div",
            { class: `gauge ${g.level}` },
            h("div", { class: "gv" }, g.value),
            h("div", { class: "gl" }, g.label),
          ),
        ),
      );
    }

    case "status_grid": {
      if (data.cells.length === 0) return emptyBox(opts.emptyText ?? DEFAULT_EMPTY);
      return h(
        "div",
        { class: "statuses" },
        ...data.cells.map((s) =>
          h(
            "div",
            { class: `status s${s.status}` },
            h("span", { class: "dot" }),
            h("span", { class: "sl" }, s.label),
            h("span", { class: "sv" }, s.value),
          ),
        ),
      );
    }
  }
}

// --- the one renderer ----------------------------------------------------------

/**
 * renderPanel(panel, data|null, honesty, opts) → <section class="panel">.
 * `data` is null only while loading or after an error — the body is then the
 * skeleton / the error line, never a guess.
 */
export function renderPanel(
  panel: PanelDef,
  data: PanelData | null,
  honesty: Honesty,
  opts: RenderOpts = {},
): HTMLElement {
  const root = h(
    "section",
    {
      class: `panel${honesty.state === "stale" ? " is-stale" : ""}${honesty.state === "error" ? " is-error" : ""}`,
      "data-panel": panel.id,
      "data-state": honesty.state,
    },
    h("div", { class: "panel-head" }, h("h2", {}, t(panel.title)), chip(honesty)),
  );

  let bodyEl: HTMLElement;
  if (honesty.state === "error") {
    // Error replaces content entirely — a failed source leaves no phantom UI.
    bodyEl = errorBox(honesty.note, opts.sourceName, opts.onRetry ?? undefined);
  } else if (honesty.state === "loading" || data === null) {
    bodyEl = skeleton(panel.render);
  } else {
    bodyEl = body(data, opts);
  }
  root.append(h("div", { class: "panel-body" }, bodyEl));

  // Traceability footer — every panel, always: source name + link, cadence,
  // and the panel's own 更新時間. A panel whose source failed keeps the link.
  const foot = h(
    "div",
    { class: "panel-foot" },
    opts.sourceUrl
      ? h("a", { class: "src", href: opts.sourceUrl, target: "_blank", rel: "noopener" },
          `${opts.sourceName ?? panel.source} · ${t(panel.cadence_note)}`)
      : h("span", { class: "src" }, `${opts.sourceName ?? panel.source} · ${t(panel.cadence_note)}`),
    h("time", {}, honesty.updatedAt ? stamp(honesty.updatedAt) : "—"),
  );
  root.append(foot);
  return root;
}
