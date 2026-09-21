// format.ts — clocks and freshness text. All times shown in Hong Kong Time;
// the dashboard's data is Hong Kong data and a drifting local clock lying about
// "2分鐘前" is a correctness bug, not a locale nicety.

import { lang } from "./i18n.ts";

export const HK_TZ = "Asia/Hong_Kong";

const rtf = new Intl.RelativeTimeFormat("zh-HK", { numeric: "always" });
const rtfEn = new Intl.RelativeTimeFormat("en", { numeric: "always" });

/** "2分鐘前" / "2 min ago" — small enough to read at a glance on a chip. */
export function ageText(at: Date, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  const fmt = lang() === "tc" ? rtf : rtfEn;
  if (s < 60) return lang() === "tc" ? "啱啱" : "just now";
  if (s < 3600) return fmt.format(-Math.floor(s / 60), "minute");
  if (s < 86400) return fmt.format(-Math.floor(s / 3600), "hour");
  return fmt.format(-Math.floor(s / 86400), "day");
}

/** Stale chip: "數據 +6分鐘" (DESIGN_BRIEF §6). */
export function staleText(at: Date, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (lang() === "tc") {
    if (m < 1) return "數據 +1分鐘內";
    if (h < 1) return `數據 +${m}分鐘`;
    return `數據 +${h}小時${m % 60 ? `${m % 60}分` : ""}`;
  }
  if (m < 1) return "data +<1 min";
  if (h < 1) return `data +${m} min`;
  return `data +${h} h${m % 60 ? ` ${m % 60} m` : ""}`;
}

const clockFmt = new Intl.DateTimeFormat("zh-HK", {
  timeZone: HK_TZ,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const dayFmt = new Intl.DateTimeFormat("zh-HK", {
  timeZone: HK_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function clockNow(now = new Date()): string {
  return clockFmt.format(now);
}

/** "2026-09-18 21:44" — panel footers: the observation timestamp, always shown. */
export function stamp(at: Date): string {
  const t = new Intl.DateTimeFormat("zh-HK", {
    timeZone: HK_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
  return `${dayFmt.format(at)} ${t}`;
}

/** Today's date in HK as YYYY-MM-DD — for sources whose URL carries a date
    (HKIA flights, radar filenames). Using the client clock's local date would
    be wrong for any visitor outside HKT. */
export function hkToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
