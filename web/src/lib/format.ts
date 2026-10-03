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

/** Stale chip: "數據 +6分鐘". */
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

/** A Date → the HKT wall-clock string the feeds publish and `relTime` re-reads:
 *  "YYYY-MM-DD HH:mm".
 *
 *  MEASURED 2026-09-25 — the two list parsers built this string with
 *  `date.toISOString().slice(0, 16).replace("T", " ")`, which is **UTC**, while
 *  `relTime` (below) parses it as **+08:00**. Producer and consumer disagreed by
 *  eight hours, so:
 *    · every 特別交通消息 row printed its time eight hours early and the relative
 *      age read 「8 小時前」 under a footer clock that said 17:02 — measured: TD
 *      ReferenceDate 17:02:37 HKT became a row reading 2026-09-25 09:02;
 *    · government-news rows shifted the same way, and since
 *      `breaking_news_list` tolerates 24h a date-only `pubDate` pushed
 *      `observedAt` past it — the panel was latched STALE while the feed's own
 *      `lastBuildDate` was two minutes old.
 *  It has to be ONE shared function rather than two matching edits, because the
 *  defect is exactly that the formatter and the parser were written separately
 *  and nothing tied them together. Anything rendering "YYYY-MM-DD HH:mm" for
 *  `relTime` must come through here.
 *
 *  `hourCycle: "h23"`, not `hour12: false`: the latter can yield "24" for midnight
 *  in some engines, which `relTime`'s regex would read as hour 24. */
export function hkWallTime(at: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: HK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}`;
}

/** "2026-09-19 16:00" (HKT wall, as feeds publish) → relative age for a
    list row ("2 日前" / "3 h ago"); the caller keeps the absolute stamp in a
    title attribute. Unknown formats pass through unchanged. */
export function relTime(isoLike: string, now = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(isoLike);
  if (!m) return isoLike;
  const at = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`);
  if (Number.isNaN(at.getTime())) return isoLike;
  const s = (now.getTime() - at.getTime()) / 1000;
  if (s < 0) return lang() === "tc" ? "啱啱" : "just now";
  if (s < 3600) return lang() === "tc" ? `${Math.max(1, Math.round(s / 60))} 分鐘前` : `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return lang() === "tc" ? `${Math.round(s / 3600)} 小時前` : `${Math.round(s / 3600)} h ago`;
  return lang() === "tc" ? `${Math.floor(s / 86400)} 日前` : `${Math.floor(s / 86400)} d ago`;
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
