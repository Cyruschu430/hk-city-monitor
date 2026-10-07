// adapters.ts — the async half of the data layer: source id → PanelData.
// Each adapter is a per-SOURCE data adapter (there is no per-vertical code
// path anywhere). Fetch routing comes from the registry's own `fetch` field;
// parsing lives in parsers.ts so it can be tested offline.
//
// Every adapter either returns data or throws — throwing is what puts a panel
// into its honest error state. It never returns a zero, an empty box, or a
// cached guess to avoid saying "I could not load this".

import { fetchSource, resolveUrl, type PanelDefRaw, type Registry, type SourceDef } from "./sources.ts";
import MTR_INDEX from "../data/mtr-stations.json";
import { searchQuery } from "./search";
import { fetchUrl } from "./sources.ts";
import { fetchDataFile, liveDataUrl } from "./sources.ts";
import * as P from "./parsers.ts";
import { lang } from "./i18n.ts";
import { liveThumb, probeLive } from "./live.ts";
import { hkToday } from "./format.ts";
import type { PanelData, StatusCell } from "./render.ts";

export interface AdapterResult {
  data: PanelData;
  /** payload's own timestamp when it carries one; the engine falls back to
      fetch time (and says so) when a source is silent. */
  observedAt: Date | null;
  /** contribution to the trigger engine's state, keyed by source id */
  state?: unknown;
  /** Point features for the map layer, when this source can be drawn. Kept
      SEPARATE from `state` so the trigger engine's shape and the map's shape
      can change independently — the water layer taught that lesson (records
      vs records_fresh had to split for the same reason). */
  geo?: GeoJSON.FeatureCollection;
}

/** Rasterisation takes a canvas, which only exists in the browser. Injected
    so adapters stay importable from Node tests. */
export interface Rasterizer {
  nowcast(grid: P.NowcastGrid, bbox: [number, number, number, number], opacity: number): Promise<string>;
  /** One data URL per forecast horizon, in time order. The map layer animates
   *  these; `nowcast` above is the single-frame form the panel uses. */
  nowcastFrames(grids: P.NowcastGrid[], bbox: [number, number, number, number], opacity: number): Promise<string[]>;
  tcTrack(track: { name: string; points: P.TcPoint[] }): Promise<string>;
}

export interface AdapterCtx {
  registry: Registry;
  raster: Rasterizer;
}

function text(res: Response): Promise<string> {
  return res.text();
}

// Each call site names the shape it expects from sources.json's documented
// payload — the registry is the contract, so the cast is the parser's signature.
// The registry payloads are untyped JSON, so this deliberately returns `any` and
// each adapter narrows it at the point of use. (The eslint-disable is advisory
// only — this repo has no eslint config, so nothing enforces it; kept so the
// intent survives if a linter is ever added.)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return await res.json();
}

/** Fetch through whichever route the registry prescribes for this source. */
async function get(src: SourceDef): Promise<Response> {
  return fetchSource(src);
}

/** Fetch an arbitrary registry-host URL (follow-up calls: the TC track XML
    lives at a URL the tc_list payload names). Both hosts are whitelisted, but
    the URL is absolute so it must still go through the proxy. */
async function getAbsolute(url: string): Promise<Response> {
  const res = await fetch(fetchUrl({ id: "__followup__", name: "followup", type: "", url, fetch: "proxy" }));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function radarFrame(src: SourceDef): Promise<AdapterResult> {
  // The radar is published as timestamped JPEGs on a 6-minute grid (~85KB each).
  //
  // WHY THIS RETURNS A DATA URL rather than the frame's URL. Two defects met
  // here, both measured:
  //   1. HKO answers a stale slot with 404 and a 180KB HTML error page. The
  //      panel renders whatever `src` it is given into an <img>, so the browser
  //      fetched that HTML as an image and Chromium threw
  //      "InvalidStateError: The source image could not be decoded" from
  //      createImageBitmap (the blob was image/png by content-type and
  //      "<!doctype html>" by magic bytes).
  //   2. Even with a content-type guard, checking a slot and then handing its
  //      URL to an <img> is a RACE — the 6-minute slot can expire in between,
  //      and the <img> is a second, unguarded request.
  //
  // Fetching once here and inlining the bytes removes both: there is exactly one
  // request, it is validated, and the renderer cannot re-request a dead URL.
  // The frames are ~85KB, so the cost is one base64 copy of a payload the page
  // already downloaded anyway.
  for (const cand of P.radarCandidates()) {
    let res: Response;
    try {
      res = await fetch(fetchUrl({ ...src, url: cand.url }));
    } catch {
      continue; // a network hiccup on one slot must not end the search
    }
    if (!res.ok) continue;
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!ct.startsWith("image/")) continue;
    const buf = await res.arrayBuffer();
    // Belt and braces: the content-type can be right while the body is an error
    // page (the 180KB HTML case above arrived labelled, so verify the magic
    // bytes too). A JPEG starts ff d8; a PNG starts 89 50 4e 47.
    const b = new Uint8Array(buf);
    const isJpeg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
    const isPng = b.length > 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    if (!isJpeg && !isPng) continue;

    // Base64 in chunks: String.fromCharCode(...bytes) overflows the call stack
    // on a large frame (measured: ~85KB blows the argument limit).
    let bin = "";
    for (let i = 0; i < b.length; i += 0x8000) {
      bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    }
    const mime = isPng ? "image/png" : "image/jpeg";
    return {
      data: {
        kind: "image_single",
        src: `data:${mime};base64,${btoa(bin)}`,
        alt: "天氣雷達 256 公里",
      },
      observedAt: cand.frameAt,
    };
  }
  throw new Error("四個時間格都攞唔到雷達圖");
}

// --- the registry of adapters -------------------------------------------------

type Adapter = (src: SourceDef, panel: PanelDefRaw, ctx: AdapterCtx) => Promise<AdapterResult>;

/** A source whose URL depends on panel params (the MTR line/station, the KMB
    stop). It keeps the registry's own `fetch` route on purpose: both hosts send
    ACAO:*, so forcing them through the Worker would make two keyless,
    browser-reachable panels depend on a deployed Worker for nothing. */
function withUrl(src: SourceDef, url: string): SourceDef {
  return { ...src, url };
}

// The live wall: one panel, region tabs, two very different scales of coverage.
//
// The regions are DERIVED FROM THE FILE — set, order and labels all read out of
// data/live_streams.json (region on each row, region_labels for the text). So adding a
// region is a data change and the adapter does not grow an opinion about which regions
// exist. Order is first-seen, which keeps the tabs stable across reloads instead of
// reordering themselves when a count changes.
//
// `region` is a panel param: absent means every stream, which is what the 全部 tab is.
// A region with no streams yields an empty wall, and an empty wall is honest (render.ts
// has an empty state) whereas silently falling back to everything would not be.
async function liveWall(src: SourceDef, panel: PanelDefRaw): Promise<AdapterResult> {
  // A curated COMMUNITY list — not official data, and the panel says so.
  // Live state is resolved at runtime via the hqdefault_live.jpg probe; an off-air tile
  // reads 現時無直播 rather than playing a black rectangle.
  const res = await fetch(src.url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as {
    region_labels?: Record<string, { tc: string; en: string }>;
    streams: { id: string; title: string; channel?: string; region?: string }[];
  };
  const labels = j.region_labels ?? {};
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const s of j.streams) {
    const r = s.region ?? "";
    if (!counts.has(r)) order.push(r);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  // An unlabelled region falls back to its raw id: ugly, but honest. A silent drop would
  // hide real streams — the same reasoning as the main tab strip in ui/grouptabs.ts.
  const regions = order.map((id) => ({ id, label: labels[id] ?? { tc: id, en: id }, count: counts.get(id) ?? 0 }));
  const active = panel.params?.["region"] ? String(panel.params["region"]) : null;
  const pool = active ? j.streams.filter((s) => (s.region ?? "") === active) : j.streams;
  const max = Number(panel.params?.["max"] ?? 8);
  const images = [];
  for (const s of pool.slice(0, max)) {
    const live = await probeLive(s.id);
    images.push({
      id: s.id,
      name: s.title,
      src: liveThumb(s.id),
      video: { id: s.id, live: live, channel: s.channel },
    });
  }
  return {
    data: {
      kind: "image_wall",
      images,
      regions,
      activeRegion: active,
      // The pool, not the drawn slice: the tile's picker offers every stream in the active
      // region, so a reader who wants the harbour instead of the runway has somewhere to say so.
      streams: pool.map((s) => ({ id: s.id, title: s.title, channel: s.channel })),
    },
    observedAt: new Date(),
  };
}

/** Fetch the MTR station index plus every terminus schedule. Shared by the panel
    adapter and the map layer's animation loop, so the layer and the panel can
    never disagree about where the trains are. ~20 keyless calls; a failed
    terminus is skipped, not fatal. */
export async function fetchMtrData(src: SourceDef): Promise<{ mtr: P.MtrStationsData; schedules: P.MtrSchedule[] }> {
  const mtr = (await json(await fetch("data/mtr_stations.json"))) as P.MtrStationsData;
  const schedules: P.MtrSchedule[] = [];
  const jobs: Promise<void>[] = [];
  for (const [line, def] of Object.entries(mtr.lines)) {
    const termini = new Set([def.DT[0], def.DT[def.DT.length - 1]].filter(Boolean));
    for (const sta of termini) {
      const url = `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${encodeURIComponent(line)}&sta=${encodeURIComponent(sta as string)}`;
      jobs.push(
        json(await fetchSource(withUrl(src, url)))
          .then((payload) => {
            const block = Object.values(payload?.data ?? {})[0] as { UP?: unknown[]; DOWN?: unknown[] } | undefined;
            for (const dir of ["UP", "DOWN"] as const) {
              for (const r of (block?.[dir] ?? []) as Record<string, unknown>[]) {
                if (String(r["valid"] ?? "Y") === "N") continue;
                schedules.push({ line, dir, dest: String(r["dest"] ?? ""), ttnt: Number(r["ttnt"]) });
              }
            }
          })
          .catch(() => {}),
      );
    }
  }
  await Promise.all(jobs);
  return { mtr, schedules };
}

/** The AQHI layer's geometry: live readings merged onto the official CSDI
 *  station positions by name (Tsuen Wan Air Quality Monitoring Station → the
 *  dashboard's "Tsuen Wan"). A name nobody can match finds no geometry and is
 *  simply not drawn — a dot in the wrong district is worse than no dot. */
async function aqhiGeo(
  j: { station?: string; aqhi?: number; health_risk?: string; publish_date?: string }[],
  ctx: AdapterCtx,
): Promise<GeoJSON.FeatureCollection> {
  const stations = (await json(await get(ctx.registry.byId.get("aqhi_stations")!))) as GeoJSON.FeatureCollection;
  const byKey = new Map<string, GeoJSON.Feature>();
  for (const f of stations.features ?? []) {
    const p = (f.properties ?? {}) as Record<string, string>;
    const key = P.aqhiStationKey(p.Name_en ?? p.Name);
    if (key) byKey.set(key, f as GeoJSON.Feature);
  }
  const features: GeoJSON.Feature[] = [];
  for (const s of j) {
    const st = s.station ? byKey.get(P.aqhiStationKey(s.station)) : undefined;
    if (!st) continue;
    features.push({
      type: "Feature",
      geometry: st.geometry,
      properties: {
        ...(st.properties ?? {}),
        aqhi: typeof s.aqhi === "number" ? String(s.aqhi) : "—",
        risk: String(s.health_risk ?? ""),
        updated: String(s.publish_date ?? "").slice(0, 16).replace("T", " "),
      },
    });
  }
  return { type: "FeatureCollection", features } as GeoJSON.FeatureCollection;
}

const ADAPTERS: Record<string, Adapter> = {
  // THE AI BRIEF. It reads the SAME payload the generator wrote - live copy first, committed
  // snapshot as the fallback - so the panel's timestamp is the model's own generation time and
  // its age is readable rather than implied. Two lines on purpose: the prose, then who wrote it.
  async ai_brief() {
    // A PANEL RENDERS A STATE; IT DOES NOT TAKE THE APP DOWN. MEASURED 2026-10-01: the first
    // version of this adapter threw when the payload was not exactly what it expected, boot's
    // await chain broke, document.body.dataset.ready never became 1, and four checks reported
    // "the app never booted" - one bad 1 KB file took the whole dashboard with it. Every path
    // below returns a list, so the reader is told what is missing instead of shown a blank page.
    const tc = lang() === "tc";
    const honest = (why: string): PanelData => ({
      kind: "list",
      items: [{ title: why, sub: tc ? "下一次排程會重寫一份" : "the next scheduled run rewrites it", ok: true }],
    });
    try {
      const res = await fetchDataFile("data/ai_summary.json");
      const j = (await res.json()) as {
        generated?: string;
        model?: string;
        provenance?: { inputs?: { file?: string }[] };
        brief?: { tc?: string; en?: string };
      };
      const prose = (tc ? j.brief?.tc : j.brief?.en) ?? "";
      if (!prose) return { data: honest(tc ? "簡報暫時冇內容" : "the brief has no text yet"), observedAt: new Date() };
      return {
        data: {
          kind: "list" as const,
          items: [
            {
              title: prose,
              // The model id and the input list are deliberately NOT on screen: a reader does not
              // need a build log, and the claim stays traceable through the link to the published
              // JSON, which records both. The panel's own source line already says the text was
              // written by a model ("… 由免費模型覆述已發佈數據" / "a free model reading published
              // data back"), which is the disclosure a reader actually needs.
              href: liveDataUrl("data/ai_summary.json") ?? undefined,
              time: String(j.generated ?? "").replace("T", " ").slice(0, 16),
              ok: true,
            },
          ],
        },
        observedAt: j.generated ? new Date(j.generated) : new Date(),
      };
    } catch (err) {
      // The panel still says something a reader can act on, and the console keeps the detail.
      console.warn("[hkcm] ai_brief:", err);
      return { data: honest(tc ? "簡報暫時讀唔到" : "the brief could not be read"), observedAt: new Date() };
    }
  },


  async mtr_next_train(src, panel) {
    const line = String(panel.params?.["line"] ?? "ISL");
    const sta = String(panel.params?.["sta"] ?? "ADM");
    const schedule = (l: string, code: string) =>
      `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${encodeURIComponent(l)}&sta=${encodeURIComponent(code)}`;

    // A reader's search overrides the pinned station . The API accepts a line plus
    // a 3-letter code and never a name, so the name is resolved against the index baked at build time
    // by scripts/build-mtr-index.mjs - stable data that costs nothing to ship and would cost a Worker
    // whitelist entry plus quota to fetch at runtime.
    const q = searchQuery(panel.id);
    // Label every row with its LINE. A station can be served by four lines and the API answers
    // per line, so a bare "往柴灣" only states the DIRECTION — at 中環 that could be 港島綫,
    // 荃灣綫, 東鐵綫 or 南港島綫. 「佢係只能夠往邊個方向」.
    //
    // It was applied on the SEARCH path only, so the pinned default drifted from it and read
    // differently depending on whether the reader had typed anything. Both paths go through this
    // one function now, which is what stops them drifting again.
    const label = <T extends { sub?: string }>(l: string, items: T[]): T[] => {
      const lineName = MTR_LINE_TC[l] ?? l;
      return items.map((it) => ({ ...it, sub: it.sub ? `${lineName} · ${it.sub}` : lineName }));
    };

    if (q) {
      const hit = findMtrStation(q);
      if (!hit) throw new Error(`搵唔到港鐵站「${q}」 · No MTR station matches "${q}"`);
      // A station on four lines needs four calls: asking the API for a line that does not serve it
      // returns no rows, and "no rows" would read as "no trains are coming" - a different, wrong claim.
      const parts = await Promise.all(
        hit.lines.map(async (l) => {
          const { items, observedAt } = P.parseMtrSchedule(await json(await fetchSource(withUrl(src, schedule(l, hit.code)))), MTR_NAME);
          return { items: label(l, items), observedAt };
        }),
      );
      const items = parts
        .flatMap((x) => x.items)
        // Numeric, not lexical - see P.minsFromLabel. Sorting the display string puts "11 分鐘"
        // ahead of "7 分鐘" and the merged list looks unsorted.
        .sort((a, b) => P.minsFromLabel(a.time) - P.minsFromLabel(b.time));
      if (items.length === 0) return { data: { kind: "list", items: [], emptyText: `${hit.tc} ${hit.en}：目前冇班次資料 · no train data right now` }, observedAt: parts[0]?.observedAt ?? null };
      return { data: { kind: "list", items }, observedAt: parts[0]?.observedAt ?? null };
    }

    const payload = await json(await fetchSource(withUrl(src, schedule(line, sta))));
    const { items, observedAt } = P.parseMtrSchedule(payload, MTR_NAME);
    return { data: { kind: "list", items: label(line, items) }, observedAt };
  },

  async kmb_eta(src, panel) {
    const stopId = panel.params?.["stop_id"];
    // Loud failure, never an empty table: an empty table says "no buses are
    // coming", which is a different claim from "this panel is misconfigured".
    if (typeof stopId !== "string" || stopId.length === 0) {
      throw new Error("kmb_eta panel 要有 params.stop_id");
    }
    // A reader's route search lists where that route stops, with the live ETA at the first stop
    // . /route-stop is keyless and CORS-open, so this is two browser-direct calls.
    // ponytail: the first stop only. Per-stop ETAs would be one request per stop on a route - add it
    // when a reader asks, and route it through the Worker if the count ever gets near the quota.
    const q = searchQuery(panel.id);
    if (q) {
      const route = q.trim().toUpperCase();
      const seqUrl = `https://data.etabus.gov.hk/v1/transport/kmb/route-stop/${encodeURIComponent(route)}/outbound/1`;
      const seq = await json(await fetchSource(withUrl(src, seqUrl)));
      const stops: string[] = (seq as { data?: { stop?: string }[] }).data?.map((x) => x.stop ?? "") ?? [];
      const firstStop = stops[0];
      if (!firstStop) {
        throw new Error(`${route} 呢條路線搵唔到 · no KMB route "${route}"`);
      }
      const etaUrl = `https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/${encodeURIComponent(firstStop)}`;
      const eta = await json(await fetchSource(withUrl(src, etaUrl)));
      const parsed = P.parseKmbStopEta(eta);
      const items = [
        { title: `${route} 首站 · ${stops.length} 個站`, sub: `${stops.length} stops on this route` },
        ...parsed.rows.slice(0, 12).map((r: unknown) => {
          // The parser hands over whatever shape the source uses; Object.values works for both a row
          // object and a row array, so this does not need to know which.
          const row = r as Record<string, string>;
          return {
            title: Object.values(row).slice(0, 2).join(" · "),
            sub: `ETA ${row["eta"] ?? ""}`.trim(),
          };
        }),
      ];
      return { data: { kind: "list", items }, observedAt: parsed.observedAt };
    }

    const url = `https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/${encodeURIComponent(stopId)}`;
    const payload = await json(await fetchSource(withUrl(src, url)));
    const { columns, rows, observedAt } = P.parseKmbStopEta(payload);
    return { data: { kind: "table", columns, rows }, observedAt };
  },

  async hko_warnsum(src) {
    const payload = (await json(await get(src))) as Record<string, P.WarnEntry>;
    const { items, observedAt } = P.parseWarnsum(payload);
    // Which warning wears which glyph is this panel's own vocabulary, so it lives here rather
    // than as a case in the renderer (no per-vertical code path). Ordered: the first
    // match wins, so the more specific pattern must come first ("暴雨" before "雨").
    const ICONS: [RegExp, string][] = [
      [/暴雨|大雨|Rainstorm|Downpour/i, "rain"],
      [/雷暴|Thunderstorm|Lightning/i, "storm"],
      [/颱風|熱帶|氣旋|Typhoon|Tropical/i, "typhoon"],
      [/酷熱|炎熱|Very Hot|Hot Weather/i, "heat"],
      [/寒冷|嚴寒|霜凍|Cold|Frost/i, "cold"],
      [/火災|Fire/i, "fire"],
      [/山泥|Landslip|Landslide/i, "slide"],
      [/海嘯|風暴潮|水浸|Tsunami|Storm Surge|Flooding/i, "wave"],
      [/季候風|強風|季風|Monsoon|Strong Wind/i, "wind"],
    ];
    for (const it of items) {
      it.icon = "warn";
      for (const [re, name] of ICONS) {
        if (re.test(it.title)) { it.icon = name; break; }
      }
    }
    return { data: { kind: "list", items }, observedAt, state: payload };
  },

  async td_specialtrafficnews(src) {
    const { items, observedAt } = P.parseSpecialTraffic(await text(await get(src)));
    return { data: { kind: "list", items }, observedAt };
  },

  async wsd_water_suspension(src) {
    // This source CANNOT be proxied: esd.wsd.gov.hk negotiates static-RSA TLS
    // (AES128-SHA), which the Worker's BoringSSL refuses — its fetch hangs to
    // the timeout and the proxy answers 504, in dev and in production. A browser
    // cannot read it either (no ACAO). The records therefore arrive through the
    // collector (scripts/build_water_suspension.py → data/water_suspension.json),
    // the same pattern the repo already uses for CORS-closed news feeds.
    // `src` is still the source of truth for the footer link.
    void src;
    const res = await fetchDataFile("data/water_suspension.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as {
      generated: string;
      counts?: { located?: number; district_only?: number; active_located?: number; active_district_only?: number };
      records: {
        id: string;
        water_type: string;
        district: string;
        district_en?: string;
        nature: string;
        suspend_at: string | null;
        resume_at: string | null;
        address: string;
        address_en?: string;
        cause: string;
        status: string;
        lat?: number | null;
        lng?: number | null;
      }[];
      active_ids: string[];
    };
    const active = j.records.filter((r) => j.active_ids.includes(r.id));
    const fmt = (iso: string | null) => (iso ? iso.slice(5, 16).replace("T", " ") : lang() === "tc" ? "待定" : "TBC");
    const tc = lang() === "tc";
    // The collector keeps the publisher's own English renderings alongside the
    // Chinese (district_en / address_en — WSD publishes both), so the ENGLISH UI
    // reads the publisher's words rather than a translation of them. MEASURED
    // 2026-09-25: this panel was the last place a language switch still showed
    // Chinese in the body, because it built its title from `district`/`address`
    // only.
    //
    // The enumerated fields (water_type, nature, cause, status) are Chinese-only
    // in the feed, so they go through a lookup with the original as its fallback:
    // an unseen value renders in Chinese rather than as a blank or a guess, which
    // is the honest failure for a closed vocabulary that could grow.
    //
    // The vocabulary is COMPLETE, not sampled. MEASURED 2026-09-25 by enumerating
    // every distinct value in the collector output across all 176 records:
    // water_type 3, nature 2, cause 8, status 4 — 17 strings in total. Listing all
    // of them once is what stops this becoming a game of whack-a-mole: the first
    // version translated the values I happened to see on screen, and the very next
    // audit still found 「更換及修復水管計劃」 untranslated.
    const WSD_EN: Record<string, string> = {
      // water_type (3)
      食水: "Fresh water",
      鹹水: "Flushing water",
      食水及鹹水: "Fresh & flushing water",
      // nature (2)
      緊急停水: "Emergency suspension",
      計劃停水: "Planned suspension",
      // cause (8)
      接駁新用戶工程: "New connection works",
      更換及修復水管計劃: "Mains replacement & rehabilitation",
      "水務署測漏組 - 水管測漏工程": "WSD leak detection survey",
      水掣測試工作: "Valve testing",
      水管改善工程: "Mains improvement works",
      維修水管工程: "Mains repair",
      緊急維修水管工程: "Emergency mains repair",
      // status (4)
      供水已恢復: "Supply restored",
      停水仍未開始: "Not yet started",
      停水已取消: "Cancelled",
      現正停水: "Suspended now",
    };
    // Key on the TRIMMED value but return a trimmed miss too: the feed contains
    // "水管改善工程 " with a trailing space, so a raw-keyed lookup would miss and
    // a raw fallback would render the stray space.
    const tr = (s: string) => {
      const key = s.trim();
      return tc ? key : (WSD_EN[key] ?? key);
    };
    // A notice carries lat/lng only when the collector resolved its address
    // through ALS (scripts/build_water_suspension.py). MEASURED 2026-09-24:
    // 173/173 resolved — but the code must not ASSUME that, because a notice
    // without coordinates still has to appear, at district level.
    const located = active.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
    const items = active.map((r) => ({
      title: `${tc ? r.district : (r.district_en ?? r.district)} ${tc ? r.address : (r.address_en ?? r.address)}`,
      sub: `${tr(r.water_type)} · ${tr(r.nature)} · ${tr(r.cause)}`,
      time: `${fmt(r.suspend_at)} → ${r.resume_at ? fmt(r.resume_at) : tc ? "待定" : "TBC"}`,
      // A geocoded notice links straight to its position on the official
      // map.gov.hk viewer, so a reader can see exactly which building it is.
      href:
        Number.isFinite(r.lat) && Number.isFinite(r.lng)
          ? `https://www.map.gov.hk/gm/map/s/${encodeURIComponent(`${r.lat},${r.lng}`)}`
          : undefined,
    }));
    const observedAt = new Date(j.generated);
    // THREE fields on purpose:
    //  · records      — every active notice in the collector output. The panel
    //                   lists them with their own timestamps and the freshness
    //                   chip, and the map highlights the same districts: that
    //                   visualises what is already on screen, nothing more.
    //  · records_fresh — empty once the collector output is older than 30 min.
    //                   Auto-hoisting a life-safety mode on stale data is the
    //                   thing we refuse.
    //  · drinking_now  — MEASURED 2026-09-24, the count that the 停水 trigger
    //                   actually needs. `records_fresh` alone was the wrong
    //                   gate: `op:"exists"` on an array is true for ANY
    //                   non-empty list, so with 6 notices in force the app
    //                   auto-switched to 停水模式 on EVERY page load and
    //                   collapsed the 18-panel overview to 1 panel. Worse, all
    //                   6 were 鹹水 (flushing water) — nobody's drinking supply
    //                   was out. Of 149 records that day, most were
    //                   供水已恢復 (already restored) and 25 were
    //                   停水仍未開始 (not yet started), so counting the raw
    //                   list is wrong twice over.
    //                   This counts only notices where the supply is out NOW
    //                   and the water is 食水 or 食水及鹹水. Salt-water-only
    //                   interruptions stay visible in the panel and on the map
    //                   — they are real, and the user asked for them — but
    //                   they do not take over the dashboard.
    const fresh = Date.now() - observedAt.getTime() < 30 * 60_000;
    const drinkingNow = fresh
      ? active.filter((r) => r.status === "現正停水" && /食水/.test(r.water_type)).length
      : 0;
    return {
      data: { kind: "list", items },
      observedAt,
      state: {
        records: active,
        records_fresh: fresh ? active : [],
        drinking_now: drinkingNow,
        salt_only_now: fresh ? active.filter((r) => r.status === "現正停水" && !/食水/.test(r.water_type)).length : 0,
        // WHAT THE MAP DRAWS.
        //  · points    — the geocoded notice locations: the actual affected
        //                buildings and streets, not whole districts. This is what
        //                the 停水 mode layer plots as pins with popups.
        //  · districts — every district with an active notice. This is the SAFETY
        //                NET for a notice ALS could not geocode: without it such a
        //                notice would vanish from the map entirely.
        //                MEASURED 2026-09-24: 0 of 176 records fell back
        //                (counts.district_only = 0, active_district_only = 0), so
        //                treat this path as UNEXERCISED, not as the norm. An
        //                earlier version of this comment claimed "only the 2
        //                fire-service notices fall back here" — that was never
        //                true of the shipped data, and it invited the reader to
        //                assume the fallback was load-bearing.
        points: located.map((r) => ({
          id: r.id,
          lat: r.lat as number,
          lng: r.lng as number,
          district: r.district,
          address: r.address,
          water_type: r.water_type,
          nature: r.nature,
          cause: r.cause,
          suspend_at: r.suspend_at,
          resume_at: r.resume_at,
        })),
        districts: [...new Set(active.map((r) => r.district).filter(Boolean))],
        located_count: located.length,
        district_only_count: active.length - located.length,
      },
    };
  },

  async immd_cp_queue(src, panel) {
    const payload = (await json(await get(src))) as Record<string, { arrQueue: number; depQueue: number }>;
    const stations = (panel.params?.["stations"] as string[] | undefined) ?? Object.keys(payload);
    // The rule engine reads thresholds off the trigger state, so publish the
    // raw queues here too. The ImD 99 sentinel is normalised to null: it means
    // "closed", and a rule comparing it as a number would see a 99-minute queue
    // at a shut border crossing — the exact misreading parseImmdQueue exists to
    // prevent.
    const queues: Record<string, { arr: number | null; dep: number | null }> = {};
    let maxQueueMin: number | null = null;
    for (const [k, v] of Object.entries(payload)) {
      const arr = v?.arrQueue >= 98 ? null : (v?.arrQueue ?? null);
      const dep = v?.depQueue >= 98 ? null : (v?.depQueue ?? null);
      queues[k] = { arr, dep };
      // Highest queue across all OPEN crossings. Closed ones are already null,
      // so they cannot masquerade as a 99-minute wait.
      for (const n of [arr, dep]) {
        if (typeof n === "number" && (maxQueueMin === null || n > maxQueueMin)) maxQueueMin = n;
      }
    }
    return {
      data: { kind: "status_grid", cells: P.parseImmdQueue(payload, stations) },
      observedAt: null,
      state: { queues, records: queues, maxQueueMin },
    };
  },

  async mardep_crossboundary_ferry(src, panel) {
    const max = Number(panel.params?.["max_rows"] ?? 20);
    // Honesty from the ROW dates, not the fetch time (the feed famously lags):
    // parseFerry returns observedAt = latest 抵達時間 in the payload, so an old
    // payload immediately degrades to amber even though the request was fresh.
    const { columns, rows, observedAt } = P.parseFerry(await text(await get(src)), max);
    // A frozen feed is not a slow one — it is STOPPED. The cross-boundary ferry
    // service is suspended upstream, so the publisher's newest row sits months back;
    // presenting that old timetable as a live arrival list passes a suspended
    // service off as a schedule. Threshold and message are config
    // (frozen_after_days / frozen_notice); observedAt is kept so the footer still
    // shows the source and the feed's own date.
    const frozenDays = Number(panel.params?.["frozen_after_days"]);
    const frozenNotice = panel.params?.["frozen_notice"] as { tc: string; en: string } | undefined;
    if (frozenDays > 0 && frozenNotice && observedAt && Date.now() - observedAt.getTime() > frozenDays * 86_400_000) {
      return { data: { kind: "table", columns: [], rows: [], frozen: frozenNotice }, observedAt };
    }
    return { data: { kind: "table", columns, rows }, observedAt };
  },

  async hkia_flights(src, panel) {
    const max = Number(panel.params?.["max_rows"] ?? 40);
    const payload = (await json(await get(src))) as unknown as Parameters<typeof P.parseFlights>[0];
    const { columns, rows, observedAt } = P.parseFlights(payload, max);
    return { data: { kind: "table", columns, rows }, observedAt };
  },

  async ha_ae_waiting(src) {
    const payload = (await json(await get(src))) as { waitTime: P.AeRow[]; updateTime?: string };
    const { cells, observedAt } = P.parseAeWaiting(payload);
    // Publish the longest A&E wait so a rule can threshold it without
    // re-parsing. The source's value is a Chinese duration string ("1 小時 30
    // 分鐘"), so it goes through the SAME zhDurationMinutes the panel uses —
    // re-deriving it here would let the rule and the panel disagree.
    const mins = (payload.waitTime ?? [])
      .map((r) => P.zhDurationMinutes(r.t45p50))
      .filter((n) => Number.isFinite(n) && n >= 0);
    return {
      data: { kind: "gauge_grid", cells },
      observedAt,
      state: { longestWaitMin: mins.length ? Math.max(...mins) : null, hospitals: mins.length },
    };
  },

  async hk_public_holidays(_src, panel) {
    // Static, prebuilt by scripts/build_leave_plan.py — the source is annual
    // and the ceremony of re-deriving it in the browser buys nothing.
    void panel;
    const res = await fetch("data/leave_plan.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const plan = (await res.json()) as Parameters<typeof P.parseLeavePlan>[0];
    const year = hkToday().slice(0, 4);
    const { columns, rows, observedAt } = P.parseLeavePlan(plan, year, 10);
    return { data: { kind: "table", columns, rows }, observedAt };
  },

  hko_radar: radarFrame,

  async ck_hk_hko_rss_latest_ten_minute_wind_info(src, _panel, ctx) {
    // Two datasets, one layer: the wind CSV carries readings but no positions,
    // the CSDI network carries positions. They are joined here so the panel and
    // the map layer read one result — and so the shortfall (stations that could
    // not be placed, or that reported no usable wind) is computed once and
    // reported honestly rather than papered over at each call site.
    const { stations, observedAt } = P.parseWindCsv(await text(await get(src)));

    let network: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    try {
      const netSrc = ctx.registry.byId.get("hko_stations_network");
      if (netSrc) network = (await json(await get(netSrc))) as GeoJSON.FeatureCollection;
    } catch {
      // Without coordinates there is no field to draw. That is an honest error,
      // not an empty map: the cells below report the readings regardless.
    }

    const joined = P.joinWindToStations(stations, network);
    const cells = P.windStatus(stations);
    // Highest measured wind speed across located stations — the number a
    // "strong wind" rule thresholds on. Null when nothing is reporting, which
    // the rule engine treats as "skip", never as zero.
    const speeds = joined.located.map((s) => s.speedKmh).filter((v): v is number => typeof v === "number");
    const maxSpeedKmh = speeds.length ? Math.max(...speeds) : null;
    if (network.features.length === 0) {
      cells.push({
        label: lang() === "tc" ? "測站座標" : "Station coords",
        value: lang() === "tc" ? "攞唔到" : "unavailable",
        status: 2,
      });
    } else {
      cells.push({
        label: lang() === "tc" ? "可上圖測站" : "Mappable stations",
        value: `${joined.located.length}/${stations.length}`,
        status: joined.located.length > 0 ? 0 : 2,
      });
      if (joined.droppedNoCoord.length) {
        cells.push({
          label: lang() === "tc" ? "無座標（唔畫）" : "No coords (not drawn)",
          value: String(joined.droppedNoCoord.length),
          status: 1,
        });
      }
    }
    return {
      data: { kind: "status_grid", cells },
      observedAt,
      state: { records: joined.located, records_fresh: joined.located, maxSpeedKmh },
      geo: P.windToGeoJson(joined.located),
    };
  },

  async adsb_fi_hk(src) {
    const { aircraft, observedAt } = P.parseAdsb(await json(await get(src)));
    // The trigger state carries the aircraft themselves: the map layer reads
    // them from here, so the panel and the map can never disagree (the same
    // contract the water-suspension districts use).
    return {
      data: { kind: "status_grid", cells: P.adsbStatus(aircraft) },
      observedAt,
      state: { records: aircraft, records_fresh: aircraft },
      geo: P.aircraftToGeoJson(aircraft),
    };
  },

  async adsb_lol_hk(src) {
    const { aircraft, observedAt } = P.parseAdsb(await json(await get(src)));
    return {
      data: { kind: "status_grid", cells: P.adsbStatus(aircraft) },
      observedAt,
      state: { records: aircraft, records_fresh: aircraft },
      geo: P.aircraftToGeoJson(aircraft),
    };
  },

  async vessel_api(src) {
    const { vessels, observedAt } = P.parseVessels(await json(await get(src)));
    // Same contract as the aircraft adapter: the trigger state carries the
    // vessels themselves, so the map layer and the panel can never disagree.
    return {
      data: { kind: "status_grid", cells: P.vesselsStatus(vessels) },
      observedAt,
      state: { records: vessels, records_fresh: vessels },
      geo: P.vesselsToGeoJson(vessels),
    };
  },

  async mtr_trains(src) {
    // Estimated positions from next-train ETAs (no GTFS-RT in HK). fetchMtrData
    // grabs each line's two termini and every upcoming train; estimateMtrTrains
    // places each by linear interpolation along its line. The `state` carries the
    // raw mtr + schedules so the map layer's animation loop can re-run the
    // estimate continuously (ttnt decremented by wall-clock) between 30s refetches.
    const { mtr, schedules } = await fetchMtrData(src);
    const trains = P.estimateMtrTrains(schedules, mtr);
    return {
      data: { kind: "status_grid", cells: P.mtrStatus(trains) },
      observedAt: new Date(),
      state: { records: trains, records_fresh: trains, mtr, schedules },
      geo: P.mtrToGeoJson(trains),
    };
  },

  async hko_rain_nowcast(src, panel, ctx) {
    const bbox = (panel.params?.["bbox"] as [number, number, number, number]) ?? [22.15, 113.83, 22.56, 114.44];
    // ALL horizons, not just the next slot. MEASURED 2026-09-25: the CSV carries
    // four half-hourly frames (+30/+60/+90/+120 min) and the old parser discarded
    // three of them, so the map could only ever show one still.
    const frames = P.parseNowcastFrames(await text(await get(src)), bbox);
    const grid = frames[0];
    if (!grid) throw new Error("格網資料為空");
    const opacity = Number(panel.params?.["opacity"] ?? 0.6);
    const observedAt = new Date(
      `${grid.updated.slice(0, 4)}-${grid.updated.slice(4, 6)}-${grid.updated.slice(6, 8)}T${grid.updated.slice(8, 10)}:${grid.updated.slice(10, 12)}:00+08:00`,
    );
    // The peak across the WHOLE forecast, not just the first frame: "rain later"
    // is the reason a reader looks at a nowcast at all, and reporting only the
    // +30min peak would understate a system that arrives in an hour.
    const peak = frames.reduce((m, g) => Math.max(m, g.max), 0);
    const legend =
      lang() === "tc"
        ? `0 → ${peak.toFixed(1)} 毫米（未來 2 小時）`
        : `0 → ${peak.toFixed(1)} mm (next 2 h)`;
    // All-zero across every horizon is the honest "no rain" state: a transparent
    // canvas is indistinguishable from a broken image, so the panel says so.
    if (peak < 0.1) {
      return { data: { kind: "raster_map", src: "", alt: "格網降雨臨近預報", empty: true, legend }, observedAt };
    }
    const rendered = await ctx.raster.nowcastFrames(frames, bbox, opacity);
    // `src` is frame 1 so the panel and any single-image consumer keep working;
    // `frames` is what the MAP animates. Each carries its own ending time, so the
    // scrubber can label a frame without recomputing the calendar.
    const labelled = rendered
      .map((s, i) => ({ src: s, ending: frames[i]?.ending ?? "" }))
      .filter((f) => f.src.length > 0);
    return {
      data: {
        kind: "raster_map",
        src: labelled[0]?.src ?? "",
        frames: labelled,
        alt: "格網降雨臨近預報",
        legend,
      },
      observedAt,
    };
  },

  async yahoo_hk_quotes(src, panel, _ctx) {
    void src;
    const symbols = (panel.params?.["symbols"] as string[] | undefined) ?? ["^HSI", "^HSCE", "0700.HK", "9988.HK"];
    const NAMES: Record<string, { tc: string; en: string; tag: string }> = {
      "^HSI": { tc: "恒生指數", en: "Hang Seng Index", tag: "指數" },
      "^HSCE": { tc: "國企指數", en: "HSCE Index", tag: "指數" },
      "0700.HK": { tc: "騰訊控股", en: "Tencent", tag: "股份" },
      "9988.HK": { tc: "阿里巴巴", en: "Alibaba", tag: "股份" },
    };
    const rows: (string | { text: string; cls: string; spark?: number[] })[][] = [];
    let observedAt: Date | null = null;
    for (const sym of symbols) {
      try {
        // interval=5m&range=1d, NOT interval=1d: measured, `interval=1d&range=1d`
        // returns exactly ONE close value, so the sparkline had nothing to draw
        // (70 points at 5m — one HK trading day). The parser always computed
        // `spark`; it was the query that made it a single point.
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1d`;
        const j = (await json(await getAbsolute(url))) as unknown;
        const q = P.parseYahooQuote(j);
        if (!q) continue;
        if (q.time && (!observedAt || q.time > observedAt)) observedAt = q.time;
        const meta = NAMES[sym] ?? { tc: sym, en: sym, tag: "" };
        const nm = lang() === "tc" ? meta.tc : meta.en;
        const up = q.changePct >= 0;
        // HK convention: red = up, green = down — the CSS class uses the
        // project tokens (--mkt-up is 紅 for rises). The tiny tag column is
        // the World-Monitor watch-list grammar (名稱 + 類別 + 價格 + 變幅).
        rows.push([
          meta.tag ? `${nm} · ${meta.tag}` : nm,
          q.price.toLocaleString("en-US", { maximumFractionDigits: 2 }),
          { text: `${up ? "+" : ""}${q.changePct.toFixed(2)}%`, cls: up ? "mkt-up" : "mkt-down", spark: q.spark },
        ]);
      } catch {
        // One symbol failing must not kill the whole market panel.
      }
    }
    if (!rows.length) throw new Error("所有報價都攞唔到");
    return { data: { kind: "table", columns: lang() === "tc" ? ["指數", "現價", "變幅"] : ["Index", "Price", "Chg"], rows }, observedAt };
  },

  async coingecko(src) {
    const ids = ["bitcoin", "ethereum"];
    const j = (await json(await get(src))) as Record<string, { hkd?: number }>;
    const { rows } = P.parseCoingecko(j, ids);
    const items = rows.map(([id, price]) => ({
      title: id === "bitcoin" ? "比特幣 BTC" : "以太幣 ETH",
      sub: lang() === "tc" ? `HK$ ${price}` : `HKD ${price}`,
    }));
    return { data: { kind: "list", items }, observedAt: null };
  },

  async gov_news_law_order(src) {
    // The official 治安 / crime-and-order announcements feed — the "突發新聞"
    // backbone (TECH_SPEC §3.7). RSS, through the proxy (CORS-closed).
    //
    // `observedAt` here is FETCH time, not the newest article's date, and the difference is the
    // whole point. MEASURED 2026-09-27: the newest 治安 article was dated three days earlier, so
    // this panel's badge read "+73小時" — on a feed that had answered successfully seconds before.
    // A list is not a measurement. "Here is the current list" is a claim about NOW, and each
    // article's age is already on its own row as "3 日前". Using the article date as the panel's
    // freshness made a healthy panel look broken, and a reader cannot tell "the feed is dead"
    // from "the government has not published lately" — which is its own kind of dishonesty.
    // parseRss still returns the newest item's date for the ticker, which does want it.
    const fetchedAt = new Date();
    const { items } = P.parseRss(await text(await get(src)), 25);
    return { data: { kind: "list", items }, observedAt: fetchedAt };
  },

  async hko_stations_network(src, _panel, ctx) {
    // CSDI FeatureServer GeoJSON: 49 official weather stations with coordinates.
    // This is a STATIC reference layer (cadence: snapshot), not a live feed —
    // it says WHERE the instruments are, which is what makes the wind barbs
    // legible ("that reading came from a station on that island").
    const fc = (await json(await get(src))) as GeoJSON.FeatureCollection;
    const features = (fc.features ?? []).filter((f) => {
      const g = f.geometry as GeoJSON.Point | null;
      return g?.type === "Point" && Number.isFinite(g.coordinates?.[0]) && Number.isFinite(g.coordinates?.[1]);
    });
    const byType: Record<string, number> = {};
    for (const f of features) {
      const t = String((f.properties ?? {})["TypesofWeatherStation_en"] ?? "OTHER");
      byType[t] = (byType[t] ?? 0) + 1;
    }
    const auto = byType["AUTOMATIC WEATHER STATION"] ?? 0;
    const cells: StatusCell[] = [
      { label: lang() === "tc" ? "測站總數" : "Stations", value: String(features.length), status: 0 },
    ];
    if (auto) cells.push({ label: lang() === "tc" ? "自動氣象站" : "Automatic", value: String(auto), status: 0 });
    const other = features.length - auto;
    if (other > 0) cells.push({ label: lang() === "tc" ? "其他類型" : "Other types", value: String(other), status: 1 });

    // 微氣候: live 1-minute regional temperatures merged onto the same station
    // positions, so a station dot can carry its own current temperature. The
    // CSV names mostly match CSDI's (36/39); the three abbreviations are
    // aliased. A name nobody can match simply shows no temperature.
    let tempByKey: Map<string, string> = new Map();
    try {
      const tempSrc = ctx.registry.byId.get("hko_1min_temperature");
      if (tempSrc) {
        const csv = await text(await get(tempSrc));
        tempByKey = P.parse1MinTemp(csv);
      }
    } catch {
      // no temperatures today: the layer keeps showing positions, honestly
    }
    for (const f of features) {
      const p = f.properties ?? {};
      const key = P.hkoStationKey(String(p["Name_en"] ?? p["Name"] ?? ""));
      const t = key ? tempByKey.get(key) : undefined;
      if (t) (p as Record<string, unknown>)["tempC"] = t;
    }

    return {
      data: { kind: "status_grid", cells },
      // the CSV is the "latest 1-minute" feed; now is honest for freshness
      observedAt: new Date(),
      state: { records: features.length },
      geo: { type: "FeatureCollection", features },
    };
  },

  async aqhi_city_dashboard(src, _panel, ctx) {
    const j = (await json(await get(src))) as { station?: string; aqhi?: number; health_risk?: string; publish_date?: string }[];
    const { cells, observedAt } = P.parseAqhiDashboard(j);
    // Publish the worst station reading for rules. AQHI is a 1-10+ index where
    // 7+ is "high" and 10+ "very high", so the max is the number that matters
    // for a city-wide alert; the mean would hide a single bad district.
    const values = j.map((s) => s.aqhi).filter((v): v is number => typeof v === "number");
    // The scale is AQHI's own, so it belongs with the readings rather than with the renderer.
    // Three colours, five bands: 高 and above all carry the alert colour, and the numbers are
    // what separates them. A bare index with no key is
    // a number a reader has to go and look up.
    const tc = lang() === "tc";
    const legend = [
      { label: tc ? "1–3 低" : "1–3 Low", cls: "ok" },
      { label: tc ? "4–6 中" : "4–6 Moderate", cls: "warn" },
      { label: tc ? "7 高" : "7 High", cls: "alert" },
      { label: tc ? "8–10 甚高" : "8–10 Very high", cls: "alert" },
      { label: tc ? "10+ 嚴重" : "10+ Serious", cls: "alert" },
    ];
    return {
      data: { kind: "gauge_grid", cells, legend },
      observedAt,
      state: { maxAqhi: values.length ? Math.max(...values) : null, stations: values.length },
      // The map layer draws the SAME records, merged with the official station
      // positions by name — dots and gauge grid cannot disagree about a
      // reading. A station the live feed names but CSDI's file does not carry
      // simply gets no geometry and is not drawn.
      geo: await aqhiGeo(j, ctx),
    };
  },

  async td_sensor_parking_occupancy(src, _panel, ctx) {
    // City-wide occupancy of on-street parking spaces installed with sensors.
    // The feed itself has no coordinates, but scripts/build_meters.py baked the
    // position of every sensor space (ParkingSpaceId is the join key), so the
    // map layer gets a live O/V dot per space while the panel keeps its counts.
    const csv = await text(await get(src));
    const s = P.parseSensorOccupancy(csv);
    // id → occupied, straight off the same CSV columns the parser pins (0 = id,
    // 2 = OccupancyStatus) — the map and the panel read the SAME parse.
    const occ = new Map<string, boolean>();
    for (const line of csv.split(/\r?\n/).slice(1)) {
      if (!line.trim()) continue;
      const c = line.split(",");
      const st = (c[2] ?? "").trim();
      if (st === "O" || st === "V") occ.set((c[0] ?? "").trim(), st === "O");
    }
    let geo: GeoJSON.FeatureCollection | null = null;
    const posSrc = ctx.registry.byId.get("td_parking_meters");
    if (posSrc) {
      try {
        const fc = (await json(await get(posSrc))) as GeoJSON.FeatureCollection;
        geo = {
          type: "FeatureCollection",
          features: (fc.features ?? []).map((f) => {
            const p = (f.properties ?? {}) as Record<string, unknown>;
            const id = String(p["id"] ?? "");
            const isOcc = occ.get(id);
            return {
              ...f,
              properties: {
                ...p,
                occupied: isOcc === undefined ? null : isOcc ? 1 : 0,
                color: isOcc === undefined ? "#5b6472" : isOcc ? "#ef3d5b" : "#34d399",
              },
            } as GeoJSON.Feature;
          }),
        };
      } catch {
        // positions missing → the layer simply cannot draw; the panel is unaffected
      }
    }
    const tc = lang() === "tc";
    const cells: StatusCell[] = [
      { label: tc ? "感應車位總數" : "Sensor spaces", value: String(s.total), status: 0 },
      { label: tc ? "泊緊" : "Occupied", value: String(s.occupied), status: 0 },
      { label: tc ? "空位" : "Vacant", value: String(s.vacant), status: 0 },
      { label: tc ? "更新日期" : "Updated", value: s.updated, status: 0 },
    ];
    const t = Date.parse(s.updated);
    return {
      data: { kind: "status_grid", cells },
      geo: geo ?? undefined,
      observedAt: Number.isFinite(t) ? new Date(t) : new Date(),
      state: { records: s.total },
    };
  },

  async td_speed_map_panels_v2(src) {
    // The five 2nd-gen speed map panels are LIVE IMAGES, not text: the dataset
    // ships a PNG per board of its current display (the board changes
    // server-side, the URL does not). The build script snapshotted the https
    // image URLs; the ?t= busts the browser cache so each refresh fetches the
    // board as it reads NOW.
    const fc = (await json(await get(src))) as GeoJSON.FeatureCollection;
    const tc = lang() === "tc";
    const images = (fc.features ?? []).map((f) => {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const url = tc ? String(p["url_tc"] ?? p["url_en"] ?? "") : String(p["url_en"] ?? "");
      return { id: String(p["id"] ?? ""), name: String(p["name_en"] ?? ""), src: `${url}?t=${Date.now()}` };
    });
    return {
      data: { kind: "image_wall", images },
      observedAt: new Date(),
    };
  },

  async epd_smart_lampposts(src) {
    // The 11 EPD smart-lamppost air-quality stations: WHERE they are and WHAT
    // they measure. The per-lamppost readings API returned no records on
    // 2026-10-06, so this is reference data — never fake live values.
    const fc = (await json(await get(src))) as GeoJSON.FeatureCollection;
    const tc = lang() === "tc";
    const rows: string[][] = [];
    for (const f of fc.features ?? []) {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      rows.push([
        String(p["id"] ?? ""),
        tc ? String(p["location_tc"] ?? "") : String(p["location_en"] ?? ""),
        tc ? String(p["district_tc"] ?? "") : String(p["district_en"] ?? ""),
        String(p["measures"] ?? ""),
      ]);
    }
    return {
      data: {
        kind: "table",
        columns: [tc ? "燈柱" : "Lamppost", tc ? "位置" : "Location", tc ? "地區" : "District", tc ? "監測項目" : "Measures"],
        rows,
      },
      observedAt: new Date(),
      state: { records: rows.length },
    };
  },

  async epd_beach_grading(src, _panel, ctx) {
    // Live daily grading merged onto the 39 static beach positions by name —
    // the same adapter feeds the panel counts and the layer dots, so they can
    // never disagree (the AQHI pattern).
    const xml = await text(await get(src));
    const grades = P.parseBeachRss(xml);
    const tc = lang() === "tc";
    const counts: Record<string, number> = { good: 0, fair: 0, poor: 0, verypoor: 0, unknown: 0 };
    for (const g of grades) counts[g.gradeKey] = (counts[g.gradeKey] ?? 0) + 1;
    const cells: StatusCell[] = [
      { label: tc ? "良好（一級）" : "Good (1)", value: String(counts.good), status: 0 },
      { label: tc ? "一般（二級）" : "Fair (2)", value: String(counts.fair), status: 1 },
      { label: tc ? "欠佳（三級）" : "Poor (3)", value: String(counts.poor), status: 2 },
      { label: tc ? "極差（四級）" : "Very poor (4)", value: String(counts.verypoor), status: 2 },
    ];
    const beaches = (await json(await get(ctx.registry.byId.get("epd_beaches")!))) as GeoJSON.FeatureCollection;
    const byName = new Map<string, GeoJSON.Feature>();
    for (const f of beaches.features ?? []) byName.set(String((f.properties ?? {})["name"] ?? ""), f);
    const features: GeoJSON.Feature[] = [];
    for (const g of grades) {
      const st = byName.get(g.name);
      if (!st || g.lat === null || g.lon === null) continue;
      features.push({
        type: "Feature",
        geometry: st.geometry,
        properties: { ...(st.properties as object), gradeTc: g.gradeTc, gradeKey: g.gradeKey },
      });
    }
    return {
      data: { kind: "status_grid", cells },
      observedAt: new Date(),
      state: { records: features.length },
      geo: { type: "FeatureCollection", features },
    };
  },

  async mtr_bus_eta(src, _panel, ctx) {
    // Live feeder-bus ETAs: the official 855-stop CSV carries the join key
    // (STATION_ID = the API's busStopId), so no name matching. One POST per
    // route; rt.data.gov.hk answers CORS `*`, so this is browser-direct.
    // 26 POSTs per refresh (5-min cadence) is the polite rhythm.
    const stops = (await json(await get(ctx.registry.byId.get("mtr_bus_stops_geojson")!))) as GeoJSON.FeatureCollection;
    const routes = [...new Set((stops.features ?? []).map((f) => String((f.properties ?? {})["route"] ?? "")))].filter(Boolean);
    const langParam = lang() === "tc" ? "zh" : "en";
    const merged = new Map<string, P.MtrBusEta>();
    let okRoutes = 0;
    await Promise.allSettled(
      routes.map(async (route) => {
        const res = await fetch(src.url, {
          method: "POST",
          headers: { "content-type": "application/json; charset=utf-8" },
          body: JSON.stringify({ language: langParam, routeName: route }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) return;
        const perStop = P.parseMtrBusEta(await res.json());
        for (const [id, eta] of perStop) merged.set(id, eta);
        okRoutes += 1;
      }),
    );
    const tc = lang() === "tc";
    const features: GeoJSON.Feature[] = [];
    for (const f of stops.features ?? []) {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const eta = merged.get(String(p["station_id"] ?? ""));
      features.push({ type: "Feature", geometry: f.geometry, properties: { ...(p as object), ...(eta ?? {}) } });
    }
    const withEta = features.filter((f) => {
      const q = (f.properties ?? {}) as Record<string, unknown>;
      return q["minutes"] != null || q["etaText"];
    });
    const cells: StatusCell[] = [
      { label: tc ? "路線" : "Routes", value: String(routes.length), status: 0 },
      { label: tc ? "站點" : "Stops", value: String(features.length), status: 0 },
      { label: tc ? "有到站資料" : "Stops with ETA", value: String(withEta.length), status: withEta.length ? 0 : 2 },
      { label: tc ? "ETA 更新成功" : "ETA routes fetched", value: `${okRoutes}/${routes.length}`, status: okRoutes === routes.length ? 0 : 1 },
    ];
    return {
      data: { kind: "status_grid", cells },
      observedAt: new Date(),
      state: { records: withEta.length },
      geo: { type: "FeatureCollection", features },
    };
  },

  async td_ai_video_analytics(_src, _panel, ctx) {
    // Live road speed from TD's AI Video Analytics: the 16 camera locations
    // (CSDI td_rcd_1671693527354_28926) carry the per-camera JSON URL in
    // `url`; every 15 minutes each returns per-segment speed/flow. 16 GETs per
    // refresh is polite; a camera whose Is_valid is N (PTZ moved out of
    // reference) contributes nothing — a stale speed would be a lie.
    const cams = (await json(await get(ctx.registry.byId.get("td_ai_cctv_stations")!))) as GeoJSON.FeatureCollection;
    const tc = lang() === "tc";
    const results = await Promise.allSettled(
      (cams.features ?? []).map(async (f) => {
        const p = (f.properties ?? {}) as Record<string, unknown>;
        const res = await fetch(String(p["url"] ?? ""), { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return { p, geom: f.geometry, t: null };
        return { p, geom: f.geometry, t: P.parseAiTraffic(await res.json()) };
      }),
    );
    const features: GeoJSON.Feature[] = [];
    const rows: string[][] = [];
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const { p, geom, t } = r.value;
      const desc = String(p["description"] ?? "");
      if (!t || !t.valid) continue; // PTZ moved / no data — nothing to say
      const speeds = t.segments.map((s) => s.speed);
      const avg = speeds.length ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : 0;
      const flow = t.segments.reduce((a, s) => a + s.flow, 0);
      const colour = avg < 10 ? "#ef4444" : avg < 30 ? "#f59e0b" : "#22c55e";
      features.push({
        type: "Feature",
        geometry: geom,
        properties: { ...(p as object), speed: String(avg), flow: String(flow), label_color: colour },
      });
      rows.push([desc, `${avg} km/h`, String(flow)]);
    }
    return {
      data: {
        kind: "table",
        columns: [tc ? "位置" : "Location", tc ? "平均車速" : "Avg speed", tc ? "流量" : "Flow"],
        rows,
      },
      observedAt: new Date(),
      state: { records: features.length },
      geo: { type: "FeatureCollection", features },
    };
  },

  async epd_ev_chargers(src) {
    // Public EV chargers (EPD): 988 locations with per-type counts, as-issued
    // (chargers get installed in batches, not per minute). No live merge — the
    // map and the panel read the same official file, and the panel is a honest
    // summary count, not a live number.
    const fc = (await json(await get(src))) as GeoJSON.FeatureCollection;
    const tc = lang() === "tc";
    const sum = (k: string) =>
      (fc.features ?? []).reduce((a, f) => a + Number((f.properties ?? {})[k] ?? 0), 0);
    const total = sum("total");
    const cells: StatusCell[] = [
      { label: tc ? "充電站" : "Stations", value: String((fc.features ?? []).length), status: 0 },
      { label: tc ? "充電器" : "Chargers", value: String(total), status: 0 },
      { label: tc ? "中速" : "Medium", value: String(sum("medium")), status: 0 },
      { label: tc ? "快速" : "Quick", value: String(sum("quick")), status: 0 },
    ];
    return {
      data: { kind: "status_grid", cells },
      observedAt: new Date(),
      state: { records: (fc.features ?? []).length },
      geo: fc,
    };
  },

  async td_journey_time_v2(src, _panel, ctx) {
    // Live journey time: ONE XML for the whole territory, joined onto the CSDI
    // indicator locations by location_id|destination_id. The label colour is
    // computed HERE (TD COLOUR_ID → hex) so the point layer needs no colour
    // expressions — the "coloured circle + minutes" look (the tunnel signs'
    // own look) is just a text layer reading per-feature `label_color`.
    const [xmlRes, locRes] = await Promise.all([
      fetch(src.url, { signal: AbortSignal.timeout(25_000) }),
      get(ctx.registry.byId.get("td_journey_time_locations")!),
    ]);
    if (!xmlRes.ok) throw new Error(`HTTP ${xmlRes.status}`);
    const readings = P.parseJourneyTime(await xmlRes.text());
    const locs = (await json(locRes)) as GeoJSON.FeatureCollection;
    const tc = lang() === "tc";
    const COLOUR_HEX: Record<number, string> = { 1: "#ef4444", 2: "#f59e0b", 3: "#22c55e" };
    const features: GeoJSON.Feature[] = [];
    const tunnelRows: { loc: string; dest: string; min: number }[] = [];
    for (const f of locs.features ?? []) {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      const r = readings.get(String(p["key"] ?? ""));
      const dest = String(p["destination_id"] ?? "");
      if (r && ["CH", "EH", "WH"].includes(dest)) {
        tunnelRows.push({ loc: String(p["name_tc"] ?? p["name_en"] ?? ""), dest, min: r.minutes });
      }
      features.push({
        type: "Feature",
        geometry: f.geometry,
        properties: { ...(p as object), ...(r ? { minutes: String(r.minutes), label_color: COLOUR_HEX[r.colour] } : {}) },
      });
    }
    const destNames: Record<string, string> = {
      CH: tc ? "紅磡海底隧道" : "Cross-Harbour Tunnel",
      EH: tc ? "東區海底隧道" : "Eastern Harbour Crossing",
      WH: tc ? "西區海底隧道" : "Western Harbour Crossing",
    };
    const rows = tunnelRows
      .sort((a, b) => (a.dest < b.dest ? -1 : a.dest > b.dest ? 1 : a.min - b.min))
      .map((t) => [destNames[t.dest] ?? t.dest, t.loc, `${t.min} ${tc ? "分鐘" : "min"}`]);
    return {
      data: {
        kind: "table",
        columns: [tc ? "隧道" : "Tunnel", tc ? "起點" : "From", tc ? "預計" : "ETA"],
        rows,
      },
      observedAt: new Date(),
      state: { records: features.filter((f) => (f.properties as Record<string, unknown>)["minutes"] != null).length },
      geo: { type: "FeatureCollection", features },
    };
  },

  async td_carpark_vacancy(src, panel, ctx) {
    const max = Number(panel.params?.["max_rows"] ?? 10);
    const infoSrc = ctx.registry.byId.get("td_carpark_info");
    if (!infoSrc) throw new Error("sources.json 冇 td_carpark_info");
    const [v, info] = await Promise.all([json(await get(src)), json(await get(infoSrc))]);
    const rowsAll = P.parseCarpark(v, info, Number.MAX_SAFE_INTEGER);
    // The reader's search box (panels.json params.search) filters by park name.
    // Max_rows caps the PANEL table only; the map geo below gets every park so
    // the layer shows all 556 spaces, not the panel's window into them.
    const q = searchQuery(panel.id);
    const filtered = q ? rowsAll.filter((r) => r.name.toLowerCase().includes(q.toLowerCase())) : rowsAll;
    const rows = filtered.slice(0, max);
    const tc = lang() === "tc";
    // THREE columns, not four. The 總數 column this panel used to show read "—"
    // for all 12 rows because `basic_info_all.json` has NO capacity field at all
    // (see parseCarpark) — a column that could never be filled, on screen, with
    // no error. It is replaced by the car park's OWN report time, which the feed
    // does carry and which the panel needs: TD updates each car park
    // independently, so one row can be minutes old beside a week-old one.
    const fmt = (d: Date | null) => {
      if (!d) return "—";
      const p = (n: number) => String(n).padStart(2, "0");
      // HKT, because every other timestamp in this app is local time.
      const h = new Date(d.getTime() + 8 * 3600_000);
      return `${p(h.getUTCMonth() + 1)}-${p(h.getUTCDate())} ${p(h.getUTCHours())}:${p(h.getUTCMinutes())}`;
    };
    const times = rows.map((r) => r.updatedAt).filter((d): d is Date => d !== null);
    return {
      data: {
        kind: "table",
        columns: tc ? ["停車場", "私家車空位", "該場更新"] : ["Carpark", "Free (car)", "Reported"],
        rows: rows.map((r) => [r.name, String(r.vacancy), fmt(r.updatedAt)]),
      },
      // The map layer draws the SAME rows through the SAME parse, so the layer
      // and the panel cannot disagree about how many spaces are left. Parks
      // without a coordinate pair are dropped by carparkToGeoJson itself.
      geo: P.carparkToGeoJson(filtered),
      // The NEWEST per-park report, so the panel's own clock is not older than
      // the freshest row it is showing. `null` when the feed carried no times at
      // all, which the panel renders as its no-timestamp state rather than
      // inventing "now".
      observedAt: times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null,
    };
  },

  live_community: liveWall,

  async hko_tc_track(src, _panel, ctx) {
    const list = P.parseTcList(await text(await get(src)));
    const first = list[0];
    if (!first) {
      // No active cyclone is a normal state, not an error: the panel says so.
      return { data: { kind: "image_single", src: "", alt: "" }, observedAt: null };
    }
    const track = P.parseTcTrack(await text(await getAbsolute(first.trackUrl)));
    // The XML often omits the Chinese name; never render "DUJUAN DUJUAN".
    const name = track.name === track.enName ? track.name : `${track.name} ${track.enName}`;
    const src2 = await ctx.raster.tcTrack({ name, points: track.points });
    return {
      data: {
        kind: "image_single",
        src: src2,
        alt: `${name} 路徑`,
        note: `${name} · ${track.points.length} 個定位點`,
      },
      observedAt: track.bulletinTime,
    };
  },

  async hko_satellite(src) {
    // MEASURED GAP (TECH_SPEC §9.2): the satellite filename embeds a date plus
    // an offset token whose rule is NOT pinned. Guessing would produce a URL
    // that 404s later while the panel still claimed to be live, so this panel
    // stays honest and names the gap instead. Upgrade path: pin the rule from
    // the HKO satellite index, then build the URL like the radar adapter does.
    throw new Error(`衛星影像檔名規則未 pin 實（見 TECH_SPEC §9.2）；來源：${src.name}`);
  },

  async hko_webcam(src) {
    // Single-station HD image, used by the drawer ("睇大圖").
    return { data: { kind: "image_single", src: fetchUrl(src), alt: "天氣攝影機" }, observedAt: null };
  },

  async td_snapshot(src) {
    return { data: { kind: "image_single", src: resolveUrl(src), alt: "交通快拍" }, observedAt: null };
  },
};

/** Resolve + run the adapter for a panel. */
export async function adaptPanel(panel: PanelDefRaw, ctx: AdapterCtx): Promise<AdapterResult> {
  const src = ctx.registry.byId.get(panel.source);
  if (!src) throw new Error(`source ${panel.source} 唔在 sources.json`);
  const adapter = ADAPTERS[panel.source];
  if (!adapter) throw new Error(`panel ${panel.id}: 未有 ${panel.source} 嘅 adapter`);
  const result = await adapter(src, panel, ctx);
  return result;
}

// --- reader search  -----------------------------------------

/** MTR line codes as the API takes them, for the row label. Codes, not a station list - the station
    index is generated from the publisher's own CSV. */
type MtrStation = { code: string; tc: string; en: string; lines: string[] };
const MTR_STATIONS = MTR_INDEX.stations as MtrStation[];

const MTR_LINE_TC: Record<string, string> = {
  AEL: "機場快綫", TCL: "東涌綫", TML: "屯馬綫", EAL: "東鐵綫", SIL: "南港島綫",
  TKL: "將軍澳綫", ISL: "港島綫", TWL: "荃灣綫", KTL: "觀塘綫", DRL: "迪士尼綫",
};

/** Every station code → bilingual name, from the build-time index. parseMtrSchedule
    resolves a schedule's `dest` code against this so the next-train panel reads
    「往 金鐘」 rather than 「往 ADM」. */
const MTR_NAME: Record<string, { tc: string; en: string }> = {};
for (const s of MTR_STATIONS) MTR_NAME[s.code] = { tc: s.tc, en: s.en };

/** Resolve "金鐘" / "admiralty" / "adm" to a station. Exact wins over prefix, prefix over substring,
    so typing a full name never lands on a longer one that merely contains it. */
export function findMtrStation(q: string): { code: string; tc: string; en: string; lines: string[] } | null {
  const needle = q.trim().toLowerCase();
  if (!needle) return null;
  const exact = MTR_STATIONS.find((s) => s.code.toLowerCase() === needle || s.tc === q.trim() || s.en.toLowerCase() === needle);
  if (exact) return exact;
  const prefix = MTR_STATIONS.find((s) => s.tc.startsWith(q.trim()) || s.en.toLowerCase().startsWith(needle));
  if (prefix) return prefix;
  return MTR_STATIONS.find((s) => s.tc.includes(q.trim()) || s.en.toLowerCase().includes(needle)) ?? null;
}

export function hasAdapter(sourceId: string): boolean {
  return sourceId in ADAPTERS;
}
