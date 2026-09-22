// parsers.ts — per-source DATA adapters. The renderer never sees these; they
// turn each source's real payload into the PanelData shapes render.ts draws.
// Parsing is split from fetching so every parser runs offline against the
// captured fixtures in web/test/fixtures/ (parsers.test.ts).
//
// Honesty rules honoured here:
//   - Big5 WSD notices are decoded as big5, never assumed UTF-8 (measured).
//   - XML feeds are flat machine-generated documents; the tag extractor is
//     deliberately small and named as a ceiling (a real XML parser is the
//     upgrade path if a feed grows nesting).
//   - observedAt comes from the PAYLOAD when it carries a timestamp; the
//     panel engine only falls back to fetch time when the source is silent.

import { lang } from "./i18n.ts";
import type { ListItem, StatusCell, Gauge } from "./render.ts";

// --- tiny flat-XML helpers ---------------------------------------------------
// Ceiling: single-level tags, no attributes needed, CDATA not used by these
// feeds. Upgrade path: DOMParser (browser) once a feed grows real nesting.
function blocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  return [...xml.matchAll(re)].map((m) => m[1] ?? "");
}
function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return (m?.[1] ?? "").trim();
}
function ent(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

// --- time helpers -------------------------------------------------------------
function iso(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "17-09-2026 22:00" (DD-MM-YYYY, Hong Kong time) */
export function parseHkDmY(s: string): Date | null {
  const m = /(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return iso(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00+08:00`);
}

/** " 2026/9/19 下午 01:10:11" — the TD special-traffic feed's locale format. */
export function parseTdDate(s: string): Date | null {
  const m = /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(上午|下午)?\s*(\d{1,2}):(\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  let hh = Number(m[5]);
  if (m[4] === "下午" && hh < 12) hh += 12;
  if (m[4] === "上午" && hh === 12) hh = 0;
  const pad = (n: string | number) => String(n).padStart(2, "0");
  return iso(`${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}T${pad(hh)}:${m[6]}:${m[7]}+08:00`);
}

/** "1 小時" / "2.5 小時" / "30 分鐘" / "少於 15 分鐘" → minutes (approximate
    for the level band only; the original string is what gets displayed). */
export function zhDurationMinutes(s: string): number {
  const h = /([\d.]+)\s*小時/.exec(s);
  if (h) return Math.round(Number(h[1]) * 60);
  const m = /(\d+)\s*分鐘/.exec(s);
  if (m) return Number(m[1]);
  return 0;
}

// --- HKO warnsum --------------------------------------------------------------
export interface WarnEntry { name: string; code: string; type?: string; issueTime?: string; updateTime?: string }

export function parseWarnsum(json: Record<string, WarnEntry>): { items: ListItem[]; observedAt: Date | null } {
  const entries = Object.values(json);
  const items: ListItem[] = entries.map((w) => ({
    title: w.type ? `${w.name}（${w.type}）` : w.name,
    time: w.issueTime ? `${lang() === "tc" ? "發出" : "Issued"} ${w.issueTime.slice(0, 16).replace("T", " ")}` : undefined,
    href: "https://www.hko.gov.hk/tc/wxinfo/dailywx/warning.html",
  }));
  const times = entries.map((w) => iso(w.updateTime ?? w.issueTime ?? "")).filter((d): d is Date => d !== null);
  return { items, observedAt: times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null };
}

// --- TD special traffic news ---------------------------------------------------
export function parseSpecialTraffic(xml: string): { items: ListItem[]; observedAt: Date | null } {
  const items: ListItem[] = [];
  const times: Date[] = [];
  for (const b of blocks(xml, "message")) {
    const tc = ent(tag(b, "ChinShort") || tag(b, "ChinText"));
    const en = ent(tag(b, "EngShort") || tag(b, "EngText"));
    const when = parseTdDate(tag(b, "ReferenceDate"));
    if (when) times.push(when);
    const text = lang() === "tc" ? tc : en;
    if (!text) continue;
    items.push({
      title: text.replace(/\s*\n\s*/g, " "),
      time: when ? when.toISOString().slice(0, 16).replace("T", " ") : undefined,
    });
  }
  items.sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""));
  return { items: items.slice(0, 20), observedAt: times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null };
}

// --- WSD water suspension (Big5, pipe-separated) --------------------------------
export interface WsdRecord {
  id: string;
  waterType: string;
  district: string;
  nature: string;
  suspendAt: Date | null;
  resumeAt: Date | null;
  address: string;
  cause: string;
  status: string;
}

export function decodeBig5(bytes: Uint8Array): string {
  return new TextDecoder("big5").decode(bytes);
}

export function parseWsd(text: string): { records: WsdRecord[]; active: WsdRecord[]; items: ListItem[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const records: WsdRecord[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split("|");
    if (c.length < 15) continue;
    records.push({
      id: c[0] ?? "",
      waterType: c[2] ?? "",
      district: c[4] ?? "",
      nature: c[6] ?? "",
      suspendAt: parseHkDmY(c[7] ?? ""),
      resumeAt: c[8] ? parseHkDmY(c[8]) : null,
      address: (c[10] ?? "").replace(/,\s*$/, ""),
      cause: c[12] ?? "",
      status: c[14] ?? "",
    });
  }
  // 「現正停水」is the live state; 「供水已恢復」stays in the feed for a while
  // and is history, not news.
  const active = records.filter((r) => r.status === "現正停水");
  const fmt = (d: Date | null) => (d ? d.toISOString().slice(5, 16).replace("T", " ") : "待定");
  const items: ListItem[] = active.map((r) => ({
    title: `${r.district} ${r.address}`,
    sub: `${r.waterType} · ${r.nature} · ${r.cause}`,
    time: `${fmt(r.suspendAt)} → ${r.resumeAt ? fmt(r.resumeAt) : lang() === "tc" ? "待定" : "TBC"}`,
  }));
  return { records, active, items };
}

// --- ImmD control-point queues ---------------------------------------------------
export const CP_STATIONS: Record<string, { tc: string; en: string }> = {
  HYW: { tc: "香園圍", en: "Heung Yuen Wai" },
  HZM: { tc: "港珠澳大橋", en: "HZMB" },
  LMC: { tc: "落馬洲", en: "Lok Ma Chau" },
  LSC: { tc: "落馬洲支線", en: "Lok Ma Chau Spur Line" },
  LWS: { tc: "羅湖", en: "Lo Wu" },
  MKT: { tc: "文錦渡", en: "Man Kam To" },
  SBC: { tc: "深圳灣", en: "Shenzhen Bay" },
  STK: { tc: "沙頭角", en: "Sha Tau Kok" },
};

export function parseImmdQueue(json: Record<string, { arrQueue: number; depQueue: number }>, stations: string[]): StatusCell[] {
  return stations
    .filter((code) => json[code])
    .map((code) => {
      const q = json[code]!;
      const worst = Math.max(q.arrQueue, q.depQueue);
      const nm = CP_STATIONS[code] ?? { tc: code, en: code };
      // MEASURED: ImmD's sentinel is 99 — the crossing is CLOSED / not
      // collecting queue data (e.g. after its daily opening hours), NOT a
      // 99-minute queue. Showing 99 分鐘 in red read as a huge queue when the
      // control point was simply shut — a truth problem, not a format one.
      if (worst >= 95) {
        return {
          label: lang() === "tc" ? nm.tc : nm.en,
          value: lang() === "tc" ? "已關閉" : "Closed",
          status: 3,
        };
      }
      // Bands: the ImmD app's own "normal" band is under 15 minutes; 30+ is
      // a genuinely long queue for a land crossing.
      const status: StatusCell["status"] = worst <= 15 ? 0 : worst <= 30 ? 1 : 2;
      // 0 minutes is ImmD's "smooth" sentinel, shown as their own 少於 15 分鐘
      // band rather than a cryptic 0′.
      const m = (mins: number) =>
        mins <= 0 ? (lang() === "tc" ? "少於 15 分鐘" : "< 15 min") : `${mins} ${lang() === "tc" ? "分鐘" : "min"}`;
      return {
        label: lang() === "tc" ? nm.tc : nm.en,
        value: `${m(q.arrQueue)} · ${m(q.depQueue)}`,
        status,
      };
    });
}

// --- MarDep cross-boundary ferries (UTF-8 BOM, pipe-separated) -------------------
export function parseFerry(text: string, maxRows: number): { columns: string[]; rows: string[][]; observedAt: Date | null } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  // (the literal above is a UTF-8 BOM, U+FEFF — the feed starts with one)
  const header = (lines[0] ?? "").split("|");
  let observedAt: Date | null = null;
  const rows = lines.slice(1, maxRows + 1).map((l) => {
    const c = l.split("|");
    // Column 0 is 抵達時間 "YYYY-MM-DD HH:mm" — the row's OWN timestamp. This
    // feed is famous for lagging: a fresh fetch can still surface rows from
    // weeks ago, so the panel's honesty must come from the ROW dates, not the
    // fetch time — observedAt = latest row date, and the panel degrades to
    // stale when those dates are old even though the HTTP request was new.
    const when = iso(c[0] ?? "");
    if (when && (!observedAt || when > observedAt)) observedAt = when;
    return [c[0]?.slice(5) ?? "", c[1] ?? "", c[2] ?? "", c[3] ?? "", c[5] ?? ""];
  });
  return {
    columns: header.length >= 6 ? [header[0]!, header[1]!, header[2]!, header[3]!, header[5]!] : ["時間", "出發地", "營運公司", "碼頭", "現況"],
    rows,
    observedAt,
  };
}

// --- HKIA flights ------------------------------------------------------------------
interface HkiaFlight { time: string; flight: { no: string }[]; status: string; origin: string[] }
interface HkiaDay { date: string; list: HkiaFlight[]; lastUpdatedTime?: string }

export function parseFlights(json: HkiaDay[], maxRows: number): { columns: string[]; rows: string[][]; observedAt: Date | null } {
  const rows: string[][] = [];
  let observedAt: Date | null = null;
  for (const day of json) {
    const lu = day.lastUpdatedTime ? iso(day.lastUpdatedTime) : null;
    if (lu && (!observedAt || lu > observedAt)) observedAt = lu;
    for (const f of day.list ?? []) {
      rows.push([
        `${day.date.slice(5)} ${f.time}`,
        f.flight.map((x) => x.no).join("／"),
        (f.origin ?? []).join("／"),
        f.status || "—",
      ]);
      if (rows.length >= maxRows) break;
    }
    if (rows.length >= maxRows) break;
  }
  const columns = lang() === "tc" ? ["時間", "航班", "來自", "狀態"] : ["Time", "Flight", "From", "Status"];
  return { columns, rows, observedAt };
}

// --- HA A&E waiting ------------------------------------------------------------------
export interface AeRow { hospName: string; t45p50: string; t45p95: string }

export function parseAeWaiting(json: { waitTime: AeRow[]; updateTime?: string }): { cells: Gauge[]; observedAt: Date | null } {
  const cells: Gauge[] = (json.waitTime ?? []).map((w) => {
    const mins = zhDurationMinutes(w.t45p50);
    // A&E triage 4/5 median: under an hour is normal for Hong Kong, over two
    // hours is a bad night. The displayed value is the source's own string.
    const level = mins <= 60 ? "ok" : mins <= 120 ? "warn" : "alert";
    return { label: w.hospName, value: w.t45p50, level };
  });
  return { cells, observedAt: json.updateTime ? iso(json.updateTime) : null };
}

// --- Leave planner (prebuilt static JSON) ----------------------------------------------
interface LeaveYear { best_bridges: { from: string; to: string; days_off: number; leave_days: number; efficiency: number; note: string }[] }

export function parseLeavePlan(json: { generated: string; years: Record<string, LeaveYear> }, year: string, maxRows: number): { columns: string[]; rows: string[][]; observedAt: Date | null } {
  const y = json.years[year];
  const rows = (y?.best_bridges ?? []).slice(0, maxRows).map((b) => [
    `${b.from.slice(5)} → ${b.to.slice(5)}`,
    String(b.days_off),
    String(b.leave_days),
    `×${b.efficiency}`,
    b.note,
  ]);
  const columns = lang() === "tc" ? ["日期", "連假", "請假", "效益", "備註"] : ["Dates", "Off", "Leave", "Gain", "Note"];
  return { columns, rows, observedAt: iso(json.generated ?? "") };
}

// --- HKO gridded rainfall nowcast -------------------------------------------------
export interface NowcastGrid {
  updated: string;
  ending: string;
  step: number;
  lats: number[]; // descending
  lons: number[]; // ascending
  vals: number[][]; // [lat][lon] mm
  max: number;
}

export function parseNowcast(csv: string, bbox: [number, number, number, number]): NowcastGrid | null {
  const [minLat, minLon, maxLat, maxLon] = bbox;
  const pad = 0.06;
  const lines = csv.split(/\r?\n/);
  let updated = "";
  let ending = "";
  const cells = new Map<string, number>();
  let step = Infinity;
  let prevLat = 0;
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i]!.split(",");
    if (c.length < 5) continue;
    if (!ending) {
      updated = c[0]!;
      ending = c[1]!;
    } else if (c[1] !== ending) {
      break; // first forecast horizon only — the map shows the next slot
    }
    const lat = Number(c[2]);
    const lon = Number(c[3]);
    if (prevLat && Math.abs(lat - prevLat) > 1e-9) step = Math.min(step, Math.abs(lat - prevLat));
    prevLat = lat;
    if (lat < minLat - pad || lat > maxLat + pad || lon < minLon - pad || lon > maxLon + pad) continue;
    cells.set(`${lat.toFixed(3)},${lon.toFixed(3)}`, Number(c[4]));
  }
  if (!cells.size) return null;
  const lats = [...new Set([...cells.keys()].map((k) => Number(k.split(",")[0])))].sort((a, b) => b - a);
  const lons = [...new Set([...cells.keys()].map((k) => Number(k.split(",")[1])))].sort((a, b) => a - b);
  let max = 0;
  const vals = lats.map((la) =>
    lons.map((lo) => {
      const v = cells.get(`${la.toFixed(3)},${lo.toFixed(3)}`) ?? 0;
      if (v > max) max = v;
      return v;
    }),
  );
  if (!Number.isFinite(step) || step === Infinity) step = 0.02;
  return { updated, ending, step, lats, lons, vals, max };
}

// --- Tropical cyclones -------------------------------------------------------------
export interface TcInfo { id: string; tcName: string; enName: string; trackUrl: string }

export function parseTcList(xml: string): TcInfo[] {
  return blocks(xml, "TropicalCyclone").map((b) => ({
    id: tag(b, "TropicalCycloneID"),
    tcName: tag(b, "TropicalCycloneChineseName"),
    enName: tag(b, "TropicalCycloneEnglishName"),
    trackUrl: tag(b, "TropicalCycloneURL").replace(/^http:\/\//, "https://"),
  })).filter((t) => t.id);
}

export interface TcPoint { lat: number; lon: number; time: string; intensity: string; wind: string; forecast: boolean }

function deg(s: string): number {
  const m = /([\d.]+)([NSEW])/.exec(s);
  if (!m) return 0;
  const v = Number(m[1]);
  return m[2] === "S" || m[2] === "W" ? -v : v;
}

export function parseTcTrack(xml: string): { name: string; enName: string; bulletinTime: Date | null; points: TcPoint[] } {
  const report = tag(xml, "WeatherReport") ? xml : "";
  const read = (blk: string, forecast: boolean): TcPoint => ({
    lat: deg(tag(blk, "Latitude")),
    lon: deg(tag(blk, "Longitude")),
    time: tag(blk, "Time"),
    intensity: tag(blk, "Intensity"),
    wind: tag(blk, "MaximumWind"),
    forecast,
  });
  const points = [
    ...blocks(report, "PastInformation").map((b) => read(b, false)),
    ...blocks(report, "ForecastInformation").map((b) => read(b, true)),
  ].filter((p) => p.lat !== 0 || p.lon !== 0);
  return {
    name: tag(xml, "TropicalCycloneChineseName") || tag(xml, "TropicalCycloneName"),
    enName: tag(xml, "TropicalCycloneEnglishName") || tag(xml, "TropicalCycloneName"),
    bulletinTime: iso(tag(xml, "BulletinTime")),
    points,
  };
}

// --- RSS feeds (news.gov.hk, RTHK) ----------------------------------------------
/** RFC 822-ish dates from RSS: "Fri, 19 Sep 2026 13:00:00 +0800" /
    "2026/09/19 13:00 +08". Parsed defensively; null when unrecognisable. */
export function parseRssDate(s: string): Date | null {
  const t = s.trim();
  const d = new Date(t.replace(/GMT|UTC/i, "Z").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (!Number.isNaN(d.getTime())) return d;
  const m = /(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/.exec(t);
  if (m) {
    const g = m.slice(1).map((x) => x ?? "");
    return iso(`${g[0]}-${g[1]!.padStart(2, "0")}-${g[2]!.padStart(2, "0")}T${g[3]!}:${g[4]!}:00+08:00`);
  }
  return null;
}

export function parseRss(xml: string, max = 25): { items: ListItem[]; observedAt: Date | null } {
  const items: ListItem[] = [];
  const times: Date[] = [];
  for (const b of blocks(xml, "item").slice(0, max)) {
    const title = ent(stripCdata(tag(b, "title")));
    const link = ent(tag(b, "link"));
    if (!title) continue;
    const when = parseRssDate(tag(b, "pubDate"));
    if (when) times.push(when);
    items.push({
      title,
      time: when ? when.toISOString().slice(0, 16).replace("T", " ") : undefined,
      href: link || undefined,
    });
  }
  return { items, observedAt: times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null };
}

function stripCdata(s: string): string {
  const m = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(s.trim());
  return m ? m[1]! : s.trim();
}

// --- Yahoo Finance chart (proxy; keyless) -----------------------------------------
export interface QuoteRow {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  time: Date | null;
  spark: number[]; // last close values, for the sparkline
}

/** v8 chart JSON → one quote row. The meta block carries the numbers; the
    close[] histogram is the sparkline. */
export function parseYahooQuote(json: unknown): QuoteRow | null {
  const result = (json as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as
    | { meta?: Record<string, unknown>; timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }
    | undefined;
  if (!result?.meta) return null;
  const price = Number(result.meta["regularMarketPrice"]);
  const prev = Number(result.meta["chartPreviousClose"] ?? result.meta["previousClose"]);
  const closes = (result.indicators?.quote?.[0]?.close ?? []).filter((c): c is number => typeof c === "number");
  const spark = closes.slice(-60).map((c) => Number(c.toFixed(1)));
  const t = result.meta["regularMarketTime"];
  return {
    symbol: String(result.meta["symbol"] ?? "?"),
    price,
    prevClose: prev || price,
    changePct: prev ? ((price - prev) / prev) * 100 : 0,
    time: typeof t === "number" ? new Date(t * 1000) : null,
    spark,
  };
}

export function parseCoingecko(json: Record<string, { hkd?: number }>, ids: string[]): { rows: [string, string, string][]; observedAt: Date | null } {
  const rows: [string, string, string][] = [];
  for (const id of ids) {
    const v = json[id]?.hkd;
    // CoinGecko may omit a coin; keep the row honest with —.
    rows.push([id, v === undefined ? "—" : Number(v).toLocaleString("en-US"), "HKD"]);
  }
  return { rows, observedAt: null };
}

// --- AQHI (EPD city-dashboard JSON) -----------------------------------------------
export interface AqhiStation { station: string; aqhi: number; healthRisk: string }

/** dashboard.data.gov.hk/aqhi-individual returns an array:
    [{station:"Central/Western", aqhi:4, health_risk:"Moderate", publish_date}].
    frontend shows the English zone name (the official AQHI labels are English
    zone names); the risk band drives the gauge colour. */
export function parseAqhiDashboard(json: unknown): { cells: Gauge[]; observedAt: Date | null } {
  const list = (json as { station?: string; aqhi?: number; health_risk?: string; publish_date?: string }[] | undefined) ?? [];
  const cells = list
    .filter((s) => s.station && typeof s.aqhi === "number")
    .map((s) => {
      const v = s.aqhi!;
      const level: Gauge["level"] = v <= 3 ? "ok" : v <= 6 ? "warn" : "alert";
      return { label: s.station!, value: String(v), level };
    });
  const times = list.map((s) => iso(s.publish_date ?? "")).filter((d): d is Date => d !== null);
  return { cells, observedAt: times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null };
}

// --- Carpark vacancy (Transport Department) ---------------------------------------
export interface CarparkRow {
  id: string;
  name: string;
  vacancy: number;
  capacity: number;
}

/** vacancy_all.json + basic_info_all.json both wrap {car_park:[…]}; merge by
    park_id. Cap at maxRows, sort by occupancy ratio (highest first) so the
    panel leads with the fullest lots. */
export function parseCarpark(vacancyJson: unknown, infoJson: unknown, maxRows: number): CarparkRow[] {
  const vac = (vacancyJson as { car_park?: { park_id?: string; vehicle_type?: { vacancy?: number }[] }[] })?.car_park ?? [];
  const info = (infoJson as { car_park?: { park_id?: string; name_tc?: string; name_en?: string; capacity?: number }[] })?.car_park ?? [];
  const byId = new Map(info.filter((p) => p.park_id).map((p) => [p.park_id!, p]));
  const rows: CarparkRow[] = [];
  for (const p of vac) {
    if (!p.park_id) continue;
    const base = byId.get(p.park_id);
    if (!base?.name_tc && !base?.name_en) continue;
    const vacancy = (p.vehicle_type ?? []).reduce((a, b) => a + (Number(b.vacancy) || 0), 0);
    const capacity = Number(base.capacity) || 0;
    rows.push({
      id: p.park_id,
      name: (base.name_tc ?? base.name_en)!,
      vacancy,
      capacity,
    });
  }
  rows.sort((a, b) => {
    const ar = a.capacity ? a.vacancy / a.capacity : 0;
    const br = b.capacity ? b.vacancy / b.capacity : 0;
    return br - ar;
  });
  return rows.slice(0, maxRows);
}

// --- ADS-B aircraft (adsb.fi and adsb.lol) -------------------------------------
// Both are keyless and ODbL-licensed (attribution required). They return the
// SAME record shape but wrap it under DIFFERENT top-level keys — measured
// against both live endpoints on 2026-09-23:
//     adsb.fi  → { now, aircraft: [...], resultCount, ptime }
//     adsb.lol → { now, ac: [...], msg, total, ctime, ptime }
// So one record parser, two envelope readers. Hardcoding either key silently
// yields an empty map for the other source, which reads as "no aircraft over
// Hong Kong" — the most misleading possible failure for this layer.

export interface Aircraft {
  hex: string;
  /** callsign / flight number, trimmed; empty when the feed omits it */
  flight: string;
  lat: number;
  lon: number;
  /** barometric altitude in feet; null when the feed reports "ground" */
  altFt: number | null;
  onGround: boolean;
  /** ground speed in knots */
  gsKt: number | null;
  /** true track over ground in degrees, clockwise from north */
  trackDeg: number | null;
  /** vertical rate, feet per minute (positive = climbing) */
  verticalFpm: number | null;
  category?: string;
}

/** One record. Both feeds use identical field names, so this is shared. */
function toAircraft(r: Record<string, unknown>): Aircraft | null {
  const lat = Number(r["lat"]);
  const lon = Number(r["lon"]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const hex = String(r["hex"] ?? "").trim();
  if (!hex) return null;

  // alt_baro is the string "ground" for an aircraft on the apron — that is NOT
  // altitude 0, and plotting it at 0 would put it mid-air on the map.
  const rawAlt = r["alt_baro"];
  const onGround = rawAlt === "ground";
  const alt = onGround ? null : Number(rawAlt);

  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    hex,
    // Callsigns are space-padded to 8 chars by the feed.
    flight: String(r["flight"] ?? "").trim(),
    lat,
    lon,
    altFt: alt !== null && Number.isFinite(alt) ? alt : null,
    onGround,
    gsKt: num(r["gs"]),
    trackDeg: num(r["track"]),
    verticalFpm: num(r["baro_rate"]),
    category: r["category"] !== undefined ? String(r["category"]) : undefined,
  };
}

/** Read either envelope. Exported so the test can prove BOTH keys work. */
export function parseAdsb(payload: unknown): { aircraft: Aircraft[]; observedAt: Date | null } {
  const doc = (payload ?? {}) as Record<string, unknown>;
  // adsb.fi says `aircraft`; adsb.lol says `ac`. Accept both, plus a bare array
  // (some mirrors return the list at the top level).
  const list = Array.isArray(doc) ? doc : (doc["aircraft"] ?? doc["ac"] ?? []);
  const rows = (Array.isArray(list) ? list : []) as Record<string, unknown>[];
  const aircraft = rows.map(toAircraft).filter((a): a is Aircraft => a !== null);
  // `now` is an epoch timestamp, but the two feeds use DIFFERENT UNITS —
  // measured 2026-09-23: adsb.fi sent 1790099582 (SECONDS) while adsb.lol sent
  // 1790099583501 (MILLISECONDS) at the same moment. Treating both as ms dates
  // the fi feed to 1970, so the panel would report an age of 56 years and the
  // engine would mark a live feed permanently stale. Anything below ~1e11 is
  // seconds (1e11 ms is 1973; 1e11 s is year 5138).
  const now = Number(doc["now"]);
  let observedAt: Date | null = null;
  if (Number.isFinite(now) && now > 0) {
    observedAt = new Date(now < 1e11 ? now * 1000 : now);
  }
  return { aircraft, observedAt };
}

/** Count summary for the panel: total, and how many are actually airborne. */
export function adsbStatus(aircraft: Aircraft[]): StatusCell[] {
  const airborne = aircraft.filter((a) => !a.onGround).length;
  const ground = aircraft.length - airborne;
  const out: StatusCell[] = [
    {
      label: lang() === "tc" ? "區內航機" : "Aircraft in range",
      value: String(aircraft.length),
      // 0 when there is traffic, 2 when the sky is genuinely empty — an empty
      // sky is worth flagging because it usually means a feed problem, not
      // calm airspace, and the operator should look.
      status: aircraft.length > 0 ? 0 : 2,
    },
  ];
  if (airborne > 0) out.push({ label: lang() === "tc" ? "空中" : "Airborne", value: String(airborne), status: 0 });
  if (ground > 0) out.push({ label: lang() === "tc" ? "地面" : "On ground", value: String(ground), status: 1 });
  const withCallsign = aircraft.filter((a) => a.flight).length;
  out.push({
    label: lang() === "tc" ? "有航班編號" : "With callsign",
    value: `${withCallsign}/${aircraft.length}`,
    status: 0,
  });
  return out;
}

/** Aircraft → point features for the map.
 *
 * `bearing` is the field the map layer reads to rotate the plane glyph, so an
 * aircraft points where it is actually flying. Records with no track are given
 * bearing 0 rather than dropped: a stationary or newly-seen aircraft is still
 * an aircraft, and hiding it would understate what is in the air.
 *
 * Altitude rides along in the properties so the popup can show it without a
 * second lookup, and so a future size-by-altitude style is config-only.
 */
export function aircraftToGeoJson(aircraft: Aircraft[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: aircraft.map((a) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [a.lon, a.lat] },
      properties: {
        hex: a.hex,
        flight: a.flight || a.hex.toUpperCase(),
        altFt: a.altFt,
        onGround: a.onGround,
        gsKt: a.gsKt,
        bearing: a.trackDeg ?? 0,
        verticalFpm: a.verticalFpm,
      },
    })),
  };
}

// --- HKO 10-minute wind (regional AWS) -----------------------------------------
// 30 automatic weather stations, refreshed every 10 minutes. The payload is a
// small CSV whose fields are NOT all numbers — measured 2026-09-23:
//     Green Island,       N/A,  27, 35     direction missing, speed present
//     Wetland Park,       Calm, Calm, 0,   wind is calm; direction meaningless
//     (last column sometimes empty)        gust absent
// So every field is parsed defensively and a station with no usable wind is
// DROPPED rather than filled in. The map requirement (ROADMAP B5) is that wind
// is never invented where there is no station, and that the field fades out
// with distance from real observations — both depend on knowing which stations
// genuinely reported.

export interface WindStation {
  name: string;
  /** compass point as published ("East", "N/A", "Calm") */
  dirText: string;
  /** degrees clockwise from north, or null when the station did not report */
  dirDeg: number | null;
  /** km/h, or null when not a number ("Calm", "N/A", blank) */
  speedKmh: number | null;
  /** km/h gust, or null */
  gustKmh: number | null;
  observedAt: Date | null;
  /** [lon, lat], filled in by joinWindToStations */
  lon?: number;
  lat?: number;
}

/** Compass point → degrees. 16-point rose, which is what HKO publishes. */
const COMPASS: Record<string, number> = {
  North: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  East: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  South: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  West: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

/** Wind-CSV station name → CSDI station name, for pairs that differ.
 *
 * Measured 2026-09-23: joining the two datasets on name alone matches 26 of 30.
 * The four that do not are NOT all missing — two are the same site published
 * under a different name, and mapping those by hand (rather than fuzzy-matching)
 * keeps the join auditable:
 *   Chek Lap Kok  → Hong Kong International Airport  (the airport is on CLK)
 *   Star Ferry    → Star Ferry(Kowloon)              (punctuation variant)
 * The other two — North Point and Hong Kong Sea School — are genuinely absent
 * from the CSDI dataset. They are DROPPED. Guessing a nearby coordinate would
 * paint an invented wind reading, which is the one thing this layer must not do
 * (ROADMAP B5). */
const STATION_ALIAS: Record<string, string> = {
  "Chek Lap Kok": "Hong Kong International Airport",
  "Star Ferry": "Star Ferry(Kowloon)",
};

/** Attach coordinates to wind readings using the CSDI station network.
 *
 * Returns only the stations that have BOTH a position and a usable wind
 * reading. Anything else is left out and counted — the caller reports the
 * shortfall rather than the map implying full coverage. */
export function joinWindToStations(
  wind: WindStation[],
  network: GeoJSON.FeatureCollection,
): { located: WindStation[]; droppedNoCoord: string[]; droppedNoWind: string[] } {
  const byName = new Map<string, [number, number]>();
  for (const f of network.features) {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const name = String(p["Name_en"] ?? p["Name_tc"] ?? "").trim();
    const g = f.geometry as GeoJSON.Point | null;
    if (!name || !g || g.type !== "Point") continue;
    const [lon, lat] = g.coordinates as [number, number];
    if (Number.isFinite(lon) && Number.isFinite(lat)) byName.set(name, [lon, lat]);
  }

  const located: WindStation[] = [];
  const droppedNoCoord: string[] = [];
  const droppedNoWind: string[] = [];

  for (const s of wind) {
    const key = STATION_ALIAS[s.name] ?? s.name;
    const pos = byName.get(key);
    if (!pos) {
      droppedNoCoord.push(s.name);
      continue;
    }
    // A station must have a speed AND a direction to contribute to a vector
    // field. "Calm" and "N/A" are not zeros — see parseWindCsv.
    if (s.speedKmh === null || s.dirDeg === null || s.speedKmh === 0) {
      droppedNoWind.push(s.name);
      continue;
    }
    located.push({ ...s, lon: pos[0], lat: pos[1] });
  }
  return { located, droppedNoCoord, droppedNoWind };
}

export function parseWindCsv(text: string): { stations: WindStation[]; observedAt: Date | null } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { stations: [], observedAt: null };

  // "202609230210" → Date. HKT (UTC+8), no DST.
  const stamp = (s: string): Date | null => {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const num = (s: string | undefined): number | null => {
    // "Calm", "N/A", "" and "-" are all NOT zero. Zero is a real wind speed.
    const t = (s ?? "").trim();
    if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const stations: WindStation[] = [];
  let observedAt: Date | null = null;

  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const name = (cols[1] ?? "").trim();
    if (!name) continue;
    const dirText = (cols[2] ?? "").trim();
    const at = stamp((cols[0] ?? "").split(" ")[0] ?? "");
    if (at && !observedAt) observedAt = at;
    stations.push({
      name,
      dirText,
      // A compass point that is not on the rose (N/A, Calm, blank) yields null,
      // never a default direction — a made-up bearing is worse than none.
      dirDeg: COMPASS[dirText] ?? null,
      speedKmh: num(cols[3]),
      gustKmh: num(cols[4]),
      observedAt: at,
    });
  }
  return { stations, observedAt };
}

/** Summary for the panel. Reports what the stations actually said, including
 *  how many could not give a direction — an honest gap, not a hidden one. */
export function windStatus(stations: WindStation[]): StatusCell[] {
  const withWind = stations.filter((s) => s.speedKmh !== null && s.dirDeg !== null);
  const calm = stations.filter((s) => s.speedKmh === 0);
  const noDir = stations.filter((s) => s.dirDeg === null);
  const speeds = withWind.map((s) => s.speedKmh!).filter((v) => v > 0);
  const max = speeds.length ? Math.max(...speeds) : 0;
  const mean = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;

  const tc = lang() === "tc";
  const out: StatusCell[] = [
    { label: tc ? "有風數據測站" : "Stations reporting", value: `${withWind.length}/${stations.length}`, status: 0 },
    { label: tc ? "平均風速" : "Mean speed", value: `${mean.toFixed(1)} km/h`, status: 0 },
    { label: tc ? "最大風速" : "Max speed", value: `${max.toFixed(0)} km/h`, status: max >= 40 ? 2 : max >= 25 ? 1 : 0 },
  ];
  if (calm.length) out.push({ label: tc ? "靜風" : "Calm", value: String(calm.length), status: 0 });
  if (noDir.length) out.push({ label: tc ? "無風向讀數" : "No direction", value: String(noDir.length), status: 1 });
  return out;
}

/** Wind-barb speed buckets, at the real-world 5/10 kt steps so the icon reads
 *  like a standard station plot. Lives here (not in the map layer) because the
 *  per-feature `barbId` is written by windToGeoJson below, and parsers.ts must
 *  stay importable from Node tests — the map layer touches `document`. */
export const BARB_BUCKETS: { maxKt: number; id: string; full: number; half: number }[] = [
  { maxKt: 2, id: "calm", full: 0, half: 0 },
  { maxKt: 7, id: "b05", full: 0, half: 1 },
  { maxKt: 12, id: "b10", full: 1, half: 0 },
  { maxKt: 17, id: "b15", full: 1, half: 1 },
  { maxKt: 22, id: "b20", full: 2, half: 0 },
  { maxKt: 27, id: "b25", full: 2, half: 1 },
  { maxKt: 32, id: "b30", full: 3, half: 0 },
  { maxKt: 37, id: "b35", full: 3, half: 1 },
  { maxKt: 1000, id: "b40", full: 4, half: 0 },
];

/** Map a km/h reading to its bucket id. km/h → knots is ×0.539957. */
export function barbIdFor(speedKmh: number): string {
  const kt = speedKmh * 0.539957;
  for (const b of BARB_BUCKETS) if (kt < b.maxKt) return b.id;
  return "b40";
}

/** Wind stations → point features for the barb layer.
 *
 * This is where the ROADMAP B5 honesty rule is enforced in data rather than in
 * prose: a barb exists only where a station MEASURED the wind, and each barb
 * carries a `fade` value that falls to zero with distance from the station.
 *
 * The grid is regular and coarse (~0.1°, roughly 11km) and covers only the
 * neighbourhood of reporting stations. `fade` is 1.0 at a station and decays to
 * 0 by ~15km — beyond that nothing is drawn, so the field can never imply
 * measured wind over an area with no measurements. IDW weighting is used for
 * the interpolated vectors, and the fade is driven by the distance to the
 * NEAREST station, not by the interpolation weights: weights normalise, so they
 * would happily produce a confident-looking vector in an empty sea.
 */
export function windToGeoJson(
  located: WindStation[],
  opts: { stepDeg?: number; fadeKm?: number } = {},
): GeoJSON.FeatureCollection {
  const step = opts.stepDeg ?? 0.1;
  const fadeKm = opts.fadeKm ?? 15;
  const features: GeoJSON.Feature[] = [];
  if (located.length === 0) return { type: "FeatureCollection", features };

  const lons = located.map((s) => s.lon!);
  const lats = located.map((s) => s.lat!);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);

  // Metres per degree at HK's latitude — good enough for a 15km fade and far
  // cheaper than a geodesic call per grid cell.
  const KM_PER_DEG_LAT = 110.574;
  const KM_PER_DEG_LON = 111.32 * Math.cos((22.3 * Math.PI) / 180);

  const toKm = (lon: number, lat: number, s: WindStation): number => {
    const dx = (lon - s.lon!) * KM_PER_DEG_LON;
    const dy = (lat - s.lat!) * KM_PER_DEG_LAT;
    return Math.sqrt(dx * dx + dy * dy);
  };

  for (let lat = minLat; lat <= maxLat + 1e-9; lat += step) {
    for (let lon = minLon; lon <= maxLon + 1e-9; lon += step) {
      let nearest = Infinity;
      let wsum = 0;
      let ux = 0, uy = 0;
      for (const s of located) {
        const d = toKm(lon, lat, s);
        if (d < nearest) nearest = d;
        // Inverse-distance weighting, squared, with a small floor so a station
        // sitting exactly on a grid cell cannot produce an infinite weight.
        const w = 1 / Math.max(d, 0.5) ** 2;
        // Meteorological direction is where the wind comes FROM; the vector
        // points where it is going, hence the +180.
        const rad = ((s.dirDeg! + 180) * Math.PI) / 180;
        ux += Math.sin(rad) * s.speedKmh! * w;
        uy += Math.cos(rad) * s.speedKmh! * w;
        wsum += w;
      }
      if (wsum === 0 || !Number.isFinite(nearest)) continue;
      // Fade: 1 at the station, 0 at fadeKm, linear in between.
      const fade = Math.max(0, Math.min(1, 1 - nearest / fadeKm));
      if (fade <= 0.02) continue; // beyond the radius: nothing is drawn at all

      const speed = Math.hypot(ux, uy) / wsum;
      // Below ~2 km/h the barb has no feathers and would render as a bare dot —
      // visual noise that says nothing. Calm water is better conveyed by ABSENCE
      // than by a field of dots, which is also what a real station plot does.
      if (speed < 2) continue;
      const dir = (Math.atan2(ux, uy) * 180) / Math.PI; // 0..360, direction TOWARD
      const dirFrom = (dir + 180 + 360) % 360; // back to meteorological convention
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lon, lat] },
        properties: {
          speedKmh: Math.round(speed * 10) / 10,
          dirDeg: Math.round(dirFrom),
          barbId: barbIdFor(speed),
          fade: Math.round(fade * 100) / 100,
          nearestKm: Math.round(nearest * 10) / 10,
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

// --- HKO radar timestamped URL ------------------------------------------------------
/** Radar filenames carry the frame time (TECH_SPEC §3.6): build the current
    6-minute slot and step back so the panel can fall back instead of 404ing. */
export function radarCandidates(now = new Date()): { url: string; frameAt: Date }[] {
  const out: { url: string; frameAt: Date }[] = [];
  // Filenames are Hong Kong time (no DST): shift to the HKT wall clock, then
  // read UTC getters on the shifted date. Frame slots are 6 minutes.
  const hkt = new Date(now.getTime() + 8 * 3_600_000);
  hkt.setUTCSeconds(0, 0);
  hkt.setUTCMinutes(hkt.getUTCMinutes() - (hkt.getUTCMinutes() % 6));
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let i = 0; i < 4; i++) {
    const t = new Date(hkt.getTime() - i * 6 * 60_000);
    const ts = `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}`;
    out.push({
      url: `https://www.hko.gov.hk/wxinfo/radars/rad_256_png/2d256nradar_${ts}.jpg`,
      frameAt: new Date(t.getTime() - 8 * 3_600_000), // back to real time
    });
  }
  return out;
}
