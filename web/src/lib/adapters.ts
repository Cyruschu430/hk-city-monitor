// adapters.ts — the async half of the data layer: source id → PanelData.
// Each adapter is a per-SOURCE data adapter (there is no per-vertical code
// path anywhere). Fetch routing comes from the registry's own `fetch` field;
// parsing lives in parsers.ts so it can be tested offline.
//
// Every adapter either returns data or throws — throwing is what puts a panel
// into its honest error state. It never returns a zero, an empty box, or a
// cached guess to avoid saying "I could not load this".

import { fetchSource, resolveUrl, type PanelDefRaw, type Registry, type SourceDef } from "./sources.ts";
import { fetchUrl } from "./sources.ts";
import * as P from "./parsers.ts";
import { lang } from "./i18n.ts";
import { hkToday } from "./format.ts";
import type { PanelData } from "./render.ts";

export interface AdapterResult {
  data: PanelData;
  /** payload's own timestamp when it carries one; the engine falls back to
      fetch time (and says so) when a source is silent. */
  observedAt: Date | null;
  /** contribution to the trigger engine's state, keyed by source id */
  state?: unknown;
}

/** Rasterisation takes a canvas, which only exists in the browser. Injected
    so adapters stay importable from Node tests. */
export interface Rasterizer {
  nowcast(grid: P.NowcastGrid, bbox: [number, number, number, number], opacity: number): Promise<string>;
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
  // The radar is published as timestamped JPEGs (~6-minute frames). Try the
  // current slot, then step back — a 404 here is expected, not a broken source.
  for (const cand of P.radarCandidates()) {
    const res = await fetch(fetchUrl({ ...src, url: cand.url }));
    if (res.ok) {
      return {
        data: { kind: "image_single", src: fetchUrl({ ...src, url: cand.url }), alt: "天氣雷達 256 公里" },
        observedAt: cand.frameAt,
      };
    }
  }
  throw new Error("四個時間格都攞唔到雷達圖");
}

// --- the registry of adapters -------------------------------------------------

type Adapter = (src: SourceDef, panel: PanelDefRaw, ctx: AdapterCtx) => Promise<AdapterResult>;

const ADAPTERS: Record<string, Adapter> = {
  async hko_warnsum(src) {
    const payload = (await json(await get(src))) as Record<string, P.WarnEntry>;
    const { items, observedAt } = P.parseWarnsum(payload);
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
    const res = await fetch(`data/water_suspension.json`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as {
      generated: string;
      records: { id: string; water_type: string; district: string; nature: string; suspend_at: string | null; resume_at: string | null; address: string; cause: string; status: string }[];
      active_ids: string[];
    };
    const active = j.records.filter((r) => j.active_ids.includes(r.id));
    const fmt = (iso: string | null) => (iso ? iso.slice(5, 16).replace("T", " ") : lang() === "tc" ? "待定" : "TBC");
    const items = active.map((r) => ({
      title: `${r.district} ${r.address}`,
      sub: `${r.water_type} · ${r.nature} · ${r.cause}`,
      time: `${fmt(r.suspend_at)} → ${r.resume_at ? fmt(r.resume_at) : lang() === "tc" ? "待定" : "TBC"}`,
    }));
    const observedAt = new Date(j.generated);
    // Only a FRESH collector run may hoist 停水模式: stale records are still
    // worth showing, but they must not drive a life-safety auto-switch.
    const fresh = Date.now() - observedAt.getTime() < 30 * 60_000;
    return {
      data: { kind: "list", items },
      observedAt,
      state: { records: fresh ? active : [] },
    };
  },

  async immd_cp_queue(src, panel) {
    const payload = (await json(await get(src))) as Record<string, { arrQueue: number; depQueue: number }>;
    const stations = (panel.params?.["stations"] as string[] | undefined) ?? Object.keys(payload);
    return { data: { kind: "status_grid", cells: P.parseImmdQueue(payload, stations) }, observedAt: null };
  },

  async mardep_crossboundary_ferry(src, panel) {
    const max = Number(panel.params?.["max_rows"] ?? 20);
    const { columns, rows } = P.parseFerry(await text(await get(src)), max);
    return { data: { kind: "table", columns, rows }, observedAt: null };
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
    return { data: { kind: "gauge_grid", cells }, observedAt };
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

  async hko_rain_nowcast(src, panel, ctx) {
    const bbox = (panel.params?.["bbox"] as [number, number, number, number]) ?? [22.15, 113.83, 22.56, 114.44];
    const grid = P.parseNowcast(await text(await get(src)), bbox);
    if (!grid) throw new Error("格網資料為空");
    const opacity = Number(panel.params?.["opacity"] ?? 0.6);
    const rendered = await ctx.raster.nowcast(grid, bbox, opacity);
    return {
      data: { kind: "raster_map", src: rendered, alt: "格網降雨臨近預報" },
      // "202609191312" = HKT wall clock
      observedAt: new Date(
        `${grid.updated.slice(0, 4)}-${grid.updated.slice(4, 6)}-${grid.updated.slice(6, 8)}T${grid.updated.slice(8, 10)}:${grid.updated.slice(10, 12)}:00+08:00`,
      ),
    };
  },

  async hko_tc_track(src, _panel, ctx) {
    const list = P.parseTcList(await text(await get(src)));
    const first = list[0];
    if (!first) {
      // No active cyclone is a normal state, not an error: the panel says so.
      return { data: { kind: "image_single", src: "", alt: "" }, observedAt: null };
    }
    const track = P.parseTcTrack(await text(await getAbsolute(first.trackUrl)));
    const src2 = await ctx.raster.tcTrack({ name: track.name || track.enName, points: track.points });
    return {
      data: {
        kind: "image_single",
        src: src2,
        alt: `${track.name} 路徑`,
        note: `${track.name} ${track.enName} · ${track.points.length} 個定位點`,
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

export function hasAdapter(sourceId: string): boolean {
  return sourceId in ADAPTERS;
}
