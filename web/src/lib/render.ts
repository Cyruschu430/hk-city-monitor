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
// Every runtime import in this file carries the .ts extension because the honesty suite loads render.ts
// under plain node ESM, where an extensionless specifier does not resolve. My first version of this
// line omitted it - and my first explanation blamed adapters.ts, which was also wrong.
import { searchQuery, setSearchQuery } from "./search.ts";
import { t, lang, type L10n } from "./i18n.ts";
import { ageText, relTime, staleText, stamp } from "./format.ts";
import type { Honesty } from "./honesty.ts";

// --- data shapes the panel engine hands over --------------------------------

export interface ListItem {
  title: string;
  sub?: string; // secondary line (place, detail)
  time?: string; // mono timestamp line
  href?: string; // link back to the source (traceability rule)
  ok?: boolean; // informational line, no warning accent
  icon?: string; // glyph name from GLYPHS below - a warning type, drawn as inline SVG
}

// The glyph set for list rows. Stroke-based, currentColor, 16x16 viewBox, so a row's accent
// colour carries into the icon and nothing needs its own palette. Keys are the names an adapter
// sends; an unknown name falls back to the generic warning triangle rather than drawing nothing,
// because a blank slot where every sibling row has an icon reads as a rendering bug.
// ponytail: 8 shapes cover the HKO warning vocabulary; a ninth type gets one more path here.
const GLYPHS: Record<string, string> = {
  warn: "M8 2.2 14.2 13H1.8zM8 6v3.2M8 11.2v.1",
  rain: "M3 3.2 1.2 8M7 3.2 5.2 8M11 3.2 9.2 8",
  storm: "M9 1.5 4 9h3.2L6 14.5 11.4 7H8.2z",
  typhoon: "M8 4.2a3.8 3.8 0 1 0 3.8 3.8M11.8 8l2.4-1.6M11.8 8l2.4 1.6",
  heat: "M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3",
  cold: "M8 1.6v12.8M3 4.5l10 7M13 4.5l-10 7",
  fire: "M8 14.4c2.3 0 4-1.6 4-3.6 0-2.6-4-4-3-9-1.9 1.9-4 3.4-4 6.2 0 .9.4 1.6 1 2 0-1.6.7-2.6.7-2.6 0 2.6-1.7 2.8-1.7 4.6 0 1.6 1.3 2.4 3 2.4z",
  slide: "M1.5 12.5 7 4.5l2.6 3.6 1.6-1.6 3.3 6z",
  wave: "M1.5 9.5c1.8 0 1.8-2 3.6-2s1.8 2 3.6 2 1.8-2 3.6-2M1.5 13c1.8 0 1.8-2 3.6-2s1.8 2 3.6 2 1.8-2 3.6-2",
  wind: "M2 5.6h7.4a2.3 2.3 0 1 0-2.3-2.3M2 10.4h9.6a2.3 2.3 0 1 1-2.3 2.3",
};

/** A 16x16 inline glyph. Returns null for a name nobody defined - callers render the name they
    were given, so the fallback is the caller's business, not a silent blank box. */
function glyphSvg(name: string): SVGSVGElement | null {
  const d = GLYPHS[name];
  if (!d) return null;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "pi-icon");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", d);
  // Stroke for line glyphs, fill for the two solid ones (storm, fire, slide, warn are outlines).
  const solid = name === "storm" || name === "fire" || name === "slide" || name === "warn";
  path.setAttribute("fill", solid ? "currentColor" : "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", solid ? "0.9" : "1.2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
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
  /** 0 nominal, 1 elevated, 2 critical, 3 CLOSED — the ImmD 99 sentinel
      means the crossing is shut, not busy; a grey dot must not be confused
      with a long queue. */
  status: 0 | 1 | 2 | 3;
}

export type TableCell = string | { text: string; cls?: string; spark?: number[] };

/** A hand-rolled SVG sparkline path — AGENTS.md: "Charts: hand-rolled SVG
    sparklines. No charting library."
    Normalised to the series' OWN min/max: an absolute scale would flatten a
    quiet day to a straight line and say nothing. A flat series draws at
    mid-height instead of dividing by zero.
    SVG y grows downward, so a rising series ends at a SMALLER y. */
export function sparkPath(values: number[], w = 56, h = 14): string {
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length < 2) return "";
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min;
  const pad = 1; // keep a 1.2px stroke inside the viewBox
  const x = (i: number) => (i / (vals.length - 1)) * w;
  const y = (v: number) => (span === 0 ? h / 2 : h - pad - ((v - min) / span) * (h - 2 * pad));
  return vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(" ");
}

/** Inline SVG must be built with createElementNS — `h()` uses createElement,
    which yields an HTMLUnknownElement for SVG tags and the browser draws
    nothing (the same reason dom.ts's icon() uses the namespace). */
function sparkSvg(values: number[], w = 56, hgt = 14): SVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "spark");
  svg.setAttribute("viewBox", `0 0 ${w} ${hgt}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(hgt));
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", sparkPath(values, w, hgt));
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "1.2");
  p.setAttribute("stroke-linejoin", "round");
  p.setAttribute("stroke-linecap", "round");
  svg.append(p);
  return svg;
}
export type PanelData =
  | { kind: "big_number"; value: string; unit?: string; sub?: string }
  | { kind: "list"; items: ListItem[] }
  | { kind: "table"; columns: string[]; rows: TableCell[][]; frozen?: L10n }
  | { kind: "image_single"; src: string; alt: string; note?: string }
  | {
      kind: "image_wall";
      images: WallImage[];
      /** Region tabs, derived from the DATA by the adapter — never a list hardcoded here.
       *  Absent (the camera walls) means no strip renders; one region is not a choice, so
       *  the strip also stays away until there are at least two. */
      regions?: { id: string; label: L10n; count: number }[];
      activeRegion?: string | null;
      /** EVERY stream the adapter had, not just the `max` it drew — the tiles show six and the
       *  reader can pick any of them from the one playing (Cyrus 2026-10-01: "Live News (allow
       *  user to volume on, expand, switch to other live streaming)"). A picker built from the
       *  drawn six would only re-arrange the six already on screen; the list has to be the pool
       *  the adapter chose from, or the feature is decoration. */
      streams?: { id: string; title: string; channel?: string }[];
    }
  | {
      kind: "raster_map";
      src: string;
      alt: string;
      legend?: string;
      empty?: boolean;
      /** Every forecast horizon, in time order, for the MAP's animation. Optional
       *  because most raster sources publish one frame; `src` stays frame 1 so a
       *  single-image consumer keeps working. Not a ninth render type — the same
       *  `raster_map` with more to show. */
      frames?: { src: string; ending: string }[];
    }
  | { kind: "gauge_grid"; cells: Gauge[]; legend?: { label: string; cls: string }[] }
  | { kind: "status_grid"; cells: StatusCell[] };

export interface PanelDef {
  id: string;
  source: string;
  render: PanelData["kind"];
  title: L10n;
  params?: Record<string, unknown>;
  cadence_note: L10n;
  /** An editorial notice shown under the panel body.
   *
   * Config, not code: the project reprints official government releases, and for
   * a feed that carries political or law-and-order material the reader has to be
   * told what they are looking at. Putting the text in panels.json means the
   * decision is reviewable in a diff and can be changed without touching the
   * renderer. It is deliberately NOT hidden in a tooltip — a disclaimer nobody
   * reads is not a disclaimer. */
  disclaimer?: L10n;
  /** Ask for the full panel-column width.
   *
   * Config, not a rule, because whether a panel benefits is a judgement about its
   * content: a 4-column table gains from the extra room, a 2-row status grid
   * looks sparse stretched across 700px. Taken from World Monitor, whose cards
   * declare `.panel-wide` (626px = both columns) in a `grid-auto-flow: dense`
   * grid — measured on worldmonitor.app/dashboard, and the mechanism by which it
   * packs 41 cards into 8.39 screens against our 17 in 3.95. */
  wide?: boolean;
}

export interface RenderOpts {
  /** source registry entry: name + link for the traceability footer */
  sourceName?: string;
  sourceUrl?: string;
  onRetry?: () => void;
  /** text for a live-but-empty panel, e.g. 現時無生效警告 */
  emptyText?: L10n;
  onImageClick?: (img: WallImage) => void;
  /** A region tab was picked; null is 全部. The ENGINE owns the choice and re-runs the
   *  adapter with it, so the renderer stays a pure function of the data handed to it and
   *  never holds selection state of its own. */
  onRegionPick?: (id: string | null) => void;
  /** Collapse a long list/table to this many rows. Comes from panels.json
      `params.max`, so the cap is config, not a hardcoded opinion. Measured
      need: special_traffic_list rendered 1304px tall in a 910px column, i.e.
      one panel taller than the screen and 7 screens of total scroll. */
  maxRows?: number;
}

const DEFAULT_EMPTY: L10n = { tc: "現時無相關資料", en: "Nothing to report right now" };

/** Wrap an image wall in its region tabs.
 *
 *  Rendered in render.ts rather than as a separate component because the tab set arrives
 *  WITH the data — the adapter derives it from the source file, so the strip is a pure
 *  function of what was fetched and cannot drift from the rows on screen. The styling is
 *  ui/grouptabs.ts's `.ptab` pill, reused rather than reinvented.
 *
 *  The strip renders even when the active region is EMPTY. Rendering it only alongside
 *  tiles would strand the reader: pick a region with nothing live right now and the tabs
 *  would vanish, leaving no way back to 全部. */
function withRegionTabs(wall: HTMLElement, data: PanelData & { kind: "image_wall" }, opts: RenderOpts): HTMLElement {
  const regions = data.regions;
  if (!regions || regions.length < 2) return wall;
  const total = regions.reduce((n, r) => n + r.count, 0);
  const tab = (key: string | null, label: L10n, count: number): HTMLElement =>
    h(
      "button",
      {
        class: "ptab",
        type: "button",
        role: "tab",
        "data-region": key ?? "",
        "aria-selected": String((data.activeRegion ?? null) === key),
        onclick: () => opts.onRegionPick?.(key),
      },
      lang() === "tc" ? label.tc : label.en,
      h("span", { class: "n" }, String(count)),
    );
  return h(
    "div",
    { class: "wallwrap" },
    h("div", { class: "walltabs", role: "tablist" }, tab(null, { tc: "全部", en: "All" }, total), ...regions.map((x) => tab(x.id, x.label, x.count))),
    wall,
  );
}

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

/** Cap a long list/table at `maxRows`, collapsed behind an explicit disclosure.
 *
 * The cap exists because a single unbounded list can be taller than the screen
 * (measured: special_traffic_list at 1304px in a 910px column, total column
 * scroll 6316px — seven screens, two panels fully visible). But hiding rows is
 * exactly the kind of thing this project must not do quietly, so the button
 * states the real count of hidden items and expands in place. Nothing is
 * discarded, and the user is TOLD the panel is truncated rather than left to
 * assume it shows everything.
 *
 * Returns the disclosure to append after the container (a <ul> appends it as a
 * sibling; a <table> needs it outside the table, hence the return value).
 */
function collapseRows(container: HTMLElement, rows: HTMLElement[], maxRows: number | undefined): HTMLElement | null {
  if (!maxRows || rows.length <= maxRows) return null;
  const hidden = rows.slice(maxRows);
  for (const r of hidden) r.remove();

  const more = h(
    "button",
    { class: "p-more", type: "button" },
    lang() === "tc" ? `另外 ${hidden.length} 項 ▾` : `${hidden.length} more ▾`,
  );
  more.addEventListener("click", () => {
    for (const r of hidden) container.append(r);
    more.remove();
  });
  return more;
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
      const rows = data.items.map((it) => {
        // A bare "YYYY-MM-DD HH:mm" timestamp reads better as a relative
        // age at a glance (World Monitor's pulse style); the full stamp is
        // kept as a hover title so nothing is hidden.
        const isStamp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(it.time ?? "");
        return h(
          "li",
          // The row is visually clamped to two lines for density, so the full
          // text goes in a tooltip: clamping without a way to read the whole
          // thing would be hiding content, not tightening layout.
          { ...(it.ok ? { class: "ok-line" } : {}), title: it.title },
          // The icon leads, because a warning type is recognised before it is read.
          (it.icon ? glyphSvg(it.icon) : null) ?? "",
          // NOT a link (Cyrus 2026-10-02: "冇咩特別原因唔好比 user redirect 去其他地方"). A row's
          // href is the SOURCE url, so a click used to leave the dashboard for a raw file. The
          // URL stays on screen in the tooltip, which is what traceability actually needs.
          it.href ? h("span", { class: "src-hold", title: it.href }, it.title) : it.title,
          it.sub ? h("span", { class: "meta" }, it.sub) : "",
          it.time
            ? h("span", { class: "meta", title: it.time }, isStamp ? relTime(it.time!) : it.time)
            : "",
        );
      });
      const list = h("ul", { class: "plist" }, ...rows);
      const more = collapseRows(list, rows, opts.maxRows);
      return more ? h("div", { class: "p-collapsed" }, list, more) : list;
    }

    case "table": {
      // A frozen feed is not an empty one: rows are withheld on purpose, so the
      // notice (which says the feed STOPPED) replaces the table instead of the
      // generic "nothing to report".
      if (data.rows.length === 0 && data.frozen) return emptyBox(data.frozen);
      if (data.rows.length === 0) return emptyBox(opts.emptyText ?? DEFAULT_EMPTY);
      // A cell may carry a sparkline under its text. It inherits currentColor,
      // so the cell's mkt-up / mkt-down class colours the line too and the
      // direction reads twice — as a number and as a shape.
      const cell = (c: TableCell) =>
        typeof c === "string"
          ? h("td", {}, c)
          : h(
              "td",
              c.cls ? { class: c.cls } : {},
              c.text,
              c.spark && c.spark.length > 1 ? sparkSvg(c.spark) : undefined,
            );
      const trs = data.rows.map((r) => h("tr", {}, ...r.map(cell)));
      const tbody = h("tbody", {}, ...trs);
      // A table collapses by moving <tr> nodes, so the shared helper is handed
      // the tbody as its "append target" rather than a <ul>. The disclosure
      // has to live OUTSIDE <table>, hence the wrapper.
      const more = collapseRows(tbody, trs, opts.maxRows);
      const table = h(
        "table",
        { class: "ptable" },
        h("thead", {}, h("tr", {}, ...data.columns.map((c) => h("th", {}, c)))),
        tbody,
      );
      return more ? h("div", { class: "p-collapsed" }, table, more) : table;
    }

    case "image_single":
      // An EMPTY src must never reach an <img>. `img.src = ""` resolves to the
      // current page URL, so the browser fetches index.html, the server answers
      // text/html, and Chromium throws "InvalidStateError: The source image
      // could not be decoded" from createImageBitmap.
      //
      // MEASURED: the failing blob was 2551 bytes, content-type image/png, magic
      // bytes "<!doctype html>" — i.e. the app's own index.html. Traced to
      // hko_tc_track returning src:"" whenever no cyclone is active, which is the
      // NORMAL state for most of the year. The same trap is documented in
      // lib/live.ts and ui/panels.ts; this closes the last path into it.
      if (!data.src) {
        return emptyBox(opts.emptyText ?? DEFAULT_EMPTY);
      }
      return h(
        "figure",
        { class: "pimg", style: "margin:0" },
        h("img", { src: data.src, alt: data.alt, loading: "lazy" }),
        data.note ? h("figcaption", { class: "note" }, data.note) : "",
      );

    case "image_wall": {
      const wall =
        data.images.length === 0
          ? emptyBox(opts.emptyText ?? DEFAULT_EMPTY)
          : h(
        "div",
        { class: "wall" },
        ...data.images.map((img) => {
          // The <img> is built out and given its own error handler: a camera
          // that fails to load right now is NOT a live frame — degrade the
          // tile instead of leaving a broken-image box.
          const im = h("img", { src: img.src, alt: img.name, loading: "lazy" }) as HTMLImageElement;
          // A confirmed-live stream plays HERE, in the panel — not in the drawer.
          // The drawer was one click to open and a second click to start, so watching
          // three streams meant three popups stacked over the map that each had to be
          // closed again. Several tiles can play at once; they are muted because no
          // browser starts several unmuted players, and a wall of them is noise.
          // A camera tile, and an off-air channel, keep the drawer: a camera has a
          // figure worth opening full size, and an off-air channel has an explanation
          // rather than a black rectangle.
          // The badge is also the STOP button while a tile plays: the player covers the
          // tile, so a click in the middle belongs to YouTube's own controls. The badge
          // sits above the frame (the frame is prepended, so later siblings paint over
          // it) and says what it does rather than leaving the reader to guess.
          const liveChip = img.video
            ? img.video.live
              ? h("span", { class: "fresh chip live", style: "background:rgba(255,93,108,.9);color:#fff" }, "LIVE 直播")
              : h("span", { class: "fresh chip" }, lang() === "tc" ? "現時無直播" : "not live now")
            : null;
          const startFrame = () => {
            const frame = document.createElement("iframe");
            frame.src = `https://www.youtube.com/embed/${img.video!.id}?autoplay=1&mute=1&playsinline=1&controls=1&fs=1`;
            frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
            frame.title = img.name;
            // prepend, not append: the label and the badge must stay clickable on top
            tile.prepend(frame);
          };
          // SWITCH STREAM, WITHOUT A LIST (Cyrus 2026-10-01: "唔要 drop down menu 好多亂碼").
          // The pool is still the adapter's whole region, but the control is two arrows: a
          // <select> of publisher stream names renders as a list of 40-character mixed-script
          // titles inside a tile 84px wide, which is unreadable at the one size it is used at.
          // The arrows cycle the pool and the label the tile already shows carries the name at
          // full width, so nothing is hidden by not listing it.
          const stepper =
            img.video && data.streams && data.streams.length > 1
              ? (() => {
                  const pool = data.streams!;
                  const box = h("div", { class: "cam-nav" });
                  const go = (d: number) => {
                    const at = pool.findIndex((s) => s.id === img.video!.id);
                    const s = pool[(at + d + pool.length) % pool.length]!;
                    img.video = { ...img.video!, id: s.id, channel: s.channel };
                    const lab = tile.querySelector(".lab");
                    if (lab) lab.textContent = `${s.title}${s.channel ? ` · ${s.channel}` : ""}`;
                    // Restart in place: the reader asked for a different stream, and a stopped
                    // player would make them click twice for one intention.
                    if (tile.classList.contains("playing")) {
                      tile.querySelector("iframe")?.remove();
                      startFrame();
                    }
                  };
                  for (const [d, glyph, word] of [
                    [-1, "‹", "上一條"],
                    [1, "›", "下一條"],
                  ] as [number, string, string][]) {
                    const b = h("button", {
                      type: "button",
                      class: "cam-nav-b",
                      title: lang() === "tc" ? `${word}直播` : `${word === "上一條" ? "previous" : "next"} stream`,
                      onclick: (e: Event) => {
                        // The tile's own click starts/stops the player; switching must not also toggle.
                        e.stopPropagation();
                        go(d);
                      },
                    });
                    b.textContent = glyph;
                    box.append(b);
                  }
                  return box;
                })()
              : null;
          const toggle = () => {
            if (!img.video?.live) {
              opts.onImageClick?.(img);
              return;
            }
            if (!tile.classList.toggle("playing")) {
              tile.querySelector("iframe")?.remove();
              if (liveChip) liveChip.textContent = "LIVE 直播";
              return;
            }
            startFrame();
            if (liveChip) liveChip.textContent = lang() === "tc" ? "■ 停止" : "■ stop";
          };
          const tile = h(
            "div",
            {
              // Live-stream tiles are 16:9 (video thumbs); camera wall tiles 4:3.
              class: `cam${img.dead ? " dead" : ""}${img.video ? " live" : ""}`,
              "data-dead": lang() === "tc" ? "暫時未能提供" : "temporarily unavailable",
              role: "button",
              tabindex: "0",
              onclick: toggle,
              onkeydown: (e) => {
                const k = (e as KeyboardEvent).key;
                if (k === "Enter" || k === " ") {
                  e.preventDefault();
                  toggle();
                }
              },
            },
            im,
            h("span", { class: "lab" }, `${img.name}${img.video?.channel ? ` · ${img.video.channel}` : ""}`),
            stepper ?? "",
            img.fresh ? h("span", { class: "fresh chip" }, img.fresh) : "",
            liveChip ?? "",
          );
          im.addEventListener("error", () => {
            if (!tile.getAttribute("class")?.includes("dead")) tile.setAttribute("class", "cam dead");
          });
          return tile;
        }),
      );
      return withRegionTabs(wall, data, opts);
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
        // Same grid, one full-width row: the panel body's child must stay .gauges or the
        // existing layout rules stop applying, so this is a row inside it, not a wrapper.
        data.legend?.length
          ? h(
              "div",
              { class: "legend" },
              ...data.legend.map((l) => h("span", { class: `legend-i ${l.cls}` }, h("i", {}), l.label)),
            )
          : "",
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
/** The reader's search box, for a panel whose registry entry declares params.search. */
function searchBox(panel: PanelDef): HTMLElement {
  const label = panel.params?.["search"];
  const text: { tc: string; en: string } =
    label && typeof label === "object" ? (label as { tc: string; en: string }) : { tc: "搜尋", en: "Search" };
  const input = h("input", {
    class: "lyr-q",
    type: "search",
    value: searchQuery(panel.id),
    placeholder: t(text),
    "aria-label": `${t(panel.title)} — ${t(text)}`,
  }) as HTMLInputElement;
  const run = () => {
    setSearchQuery(panel.id, input.value);
    // The panel is rebuilt from the registry on the next poll, so ask for that poll now.
    (window as unknown as { __hkcm?: { refreshAll?: () => void } }).__hkcm?.refreshAll?.();
  };
  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      run();
    }
  });
  // Emptying the box and leaving it clears the search, which restores the pinned station.
  input.addEventListener("blur", () => {
    if (input.value.trim() === "") run();
  });
  return input;
}

export function renderPanel(
  panel: PanelDef,
  data: PanelData | null,
  honesty: Honesty,
  opts: RenderOpts = {},
): HTMLElement {
  const root = h(
    "section",
    {
      class: `panel${panel.wide ? " wide" : ""}${honesty.state === "stale" ? " is-stale" : ""}${honesty.state === "error" ? " is-error" : ""}`,
      "data-panel": panel.id,
      "data-state": honesty.state,
    },
    h(
      "div",
      { class: "panel-head" },
      h("h2", {}, t(panel.title)),
      // Reader search (Cyrus 2026-10-02), only for panels whose registry entry declares it. The box
      // reuses the layer control's own filter class (lyr-q) rather than introducing a second look, and
      // Enter calls window.__hkcm.refreshAll() - the hook the app already exposes for QA - instead of
      // threading a new callback down from ui/panels.ts.
      panel.params?.["search"] ? searchBox(panel) : null,
      chip(honesty),
    ),
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

  // Editorial notice, when the panel declares one. Rendered ABOVE the footer so
  // it reads as part of the content rather than as metadata chrome.
  if (panel.disclaimer) {
    root.append(h("p", { class: "panel-disclaimer" }, t(panel.disclaimer)));
  }

  // Traceability footer — every panel, always: source name + link, cadence,
  // and the panel's own 更新時間. A panel whose source failed keeps the link.
  const foot = h(
    "div",
    { class: "panel-foot" },
    opts.sourceUrl
      ? h("span", { class: "src src-hold", title: opts.sourceUrl },
          `${opts.sourceName ?? panel.source} · ${t(panel.cadence_note)}`)
      : h("span", { class: "src" }, `${opts.sourceName ?? panel.source} · ${t(panel.cadence_note)}`),
    h("time", {}, honesty.updatedAt ? stamp(honesty.updatedAt) : "—"),
  );
  root.append(foot);
  return root;
}
