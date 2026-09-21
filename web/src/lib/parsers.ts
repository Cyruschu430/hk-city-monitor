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
      // Bands: the ImmD app's own "normal" band is under 15 minutes; 30+ is
      // a genuinely long queue for a land crossing.
      const status: 0 | 1 | 2 = worst <= 15 ? 0 : worst <= 30 ? 1 : 2;
      const nm = CP_STATIONS[code] ?? { tc: code, en: code };
      return {
        label: lang() === "tc" ? nm.tc : nm.en,
        value: lang() === "tc" ? `到${q.arrQueue}′ 離${q.depQueue}′` : `in ${q.arrQueue}′ out ${q.depQueue}′`,
        status,
      };
    });
}

// --- MarDep cross-boundary ferries (UTF-8 BOM, pipe-separated) -------------------
export function parseFerry(text: string, maxRows: number): { columns: string[]; rows: string[][] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  // (the literal above is a UTF-8 BOM, U+FEFF — the feed starts with one)
  const header = (lines[0] ?? "").split("|");
  const rows = lines.slice(1, maxRows + 1).map((l) => {
    const c = l.split("|");
    return [c[0]?.slice(5) ?? "", c[1] ?? "", c[2] ?? "", c[3] ?? "", c[5] ?? ""];
  });
  return { columns: header.length >= 6 ? [header[0]!, header[1]!, header[2]!, header[3]!, header[5]!] : ["時間", "出發地", "營運公司", "碼頭", "現況"], rows };
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
