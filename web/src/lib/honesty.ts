// honesty.ts — the four states every data surface must visibly implement
// (PRIMITIVES §6, DESIGN_BRIEF §6): loading / live / stale / error.
// A panel past its freshness threshold must LOOK degraded; stale data may
// never be presented as live. This module is the single place that decides.

export type HonestyState = "loading" | "live" | "stale" | "error";

export interface Honesty {
  state: HonestyState;
  /** observation time as reported/observed; shown verbatim in the footer */
  updatedAt: Date | null;
  /** one-line failure note for the error state — names what failed */
  note?: string;
}

export const LOADING: Honesty = { state: "loading", updatedAt: null };

export function live(updatedAt: Date): Honesty {
  return { state: "live", updatedAt };
}

export function errored(note: string, updatedAt: Date | null = null): Honesty {
  return { state: "error", updatedAt, note };
}

/**
 * Cadence-aware freshness: stale once the reading is older than the source's
 * quiet tolerance (see `quietSeconds`), which is 2× the cadence for ordinary
 * polled feeds and an explicit longer window for push-style and reference
 * sources. A fetch failure is always an immediate error for warnings and
 * market data — that decision lives in the panel engine, which calls errored().
 *
 * Note the parameter is the *tolerance*, not the cadence: passing a cadence
 * here re-introduces the doubling and is what made a "continuous" news feed
 * stale after 10 minutes. Callers pass `quietSeconds(src?.cadence)`.
 */
export function degrade(h: Honesty, toleranceSeconds: number, now = new Date()): Honesty {
  if (h.state !== "live" || !h.updatedAt) return h;
  const age = (now.getTime() - h.updatedAt.getTime()) / 1000;
  if (age > toleranceSeconds) return { state: "stale", updatedAt: h.updatedAt };
  return h;
}

/**
 * The cadence strings sources.json is allowed to use the 5-minute default for.
 *
 * WHY THIS LIST EXISTS. The original defect was not that one string was mapped
 * wrongly — it was that EVERY unrecognised string silently became 300s. Fixing
 * individual strings does not close that hole; the next new string falls into it
 * just as quietly. Naming the members turns "silently unhandled" into "listed on
 * purpose", and honesty.test.ts asserts the real registry against this list, so
 * a new unhandled cadence shows up as a failing test rather than a wrong badge.
 *
 * MEASURED 2026-09-24 (recounted 2026-09-25): sources.json carries **53 distinct
 * cadence strings**. These three still land on the default, deliberately:
 *   "live"    1 source  (afcd_closed_facilities) — a closure status feed; 5 min
 *                        is the right poll rate and 10 min the right tolerance.
 *   "delayed" 2 sources (yahoo_hsi, yahoo_hk_quotes) — Yahoo's delayed quotes
 *                        refresh every ~5 min, so 5 min is the true cadence. NOT
 *                        push-style: a market panel must go stale when the tape
 *                        stops, which is why it is not in the 24h tier below.
 *   "minutes" 1 source  — a bare unit with no number.
 */
export const POLL_DEFAULT_MEMBERS = ["live", "delayed", "minutes"];

/**
 * Parse the cadence strings in sources.json ("5 minutes", "hourly",
 * "continuous", "as issued", "snapshot"…) into seconds.
 *
 * MEASURED 2026-09-24: the registry uses **53 distinct cadence strings** (count
 * re-taken 2026-09-25), and the previous version of this function only understood
 * numeric ones. Every non-numeric string that was not hourly/daily/as-issued fell
 * through to the 300s default — which was wrong in both directions:
 *
 *   "continuous" (18 sources) → 300s → a government news category, which is
 *     quiet overnight *by nature*, was painted stale after 10 minutes. This is
 *     the bug behind 突發新聞 reading "+27h".
 *   "snapshot" (10), "static" (4), "monthly", "annual", "decennial" → 300s →
 *     a reference layer that changes once a decade was judged stale in the
 *     same 10 minutes.
 *
 * A cadence is not one number: it is a *rate* for polling and a *quiet-period
 * tolerance* for honesty. `cadenceSeconds` answers the first question and
 * `quietSeconds` the second; keeping them separate is what stops a correct
 * poll loop from producing an incorrect staleness badge.
 *
 * Anything NOT in POLL_DEFAULT_MEMBERS reaching the final `return 300` is a
 * string nobody has classified — see the note on that constant.
 */
export function cadenceSeconds(cadence: string | undefined): number {
  if (!cadence) return 300;
  const m = /(\d+)\s*(minute|min|hour|second|sec)/i.exec(cadence);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2]!.toLowerCase();
    if (unit.startsWith("hour")) return n * 3600;
    if (unit.startsWith("sec")) return n;
    return n * 60;
  }
  // "hourly" / "daily" carry no leading number — don't let them fall
  // through to the 5-minute default, or an hourly model flashes stale.
  if (/hourly|per hour|每小時/i.test(cadence)) return 3600;
  if (/daily|per day|每日/i.test(cadence)) return 86_400;
  return 300;
}

/**
 * How long a reading may go unchanged before it is *honestly* stale.
 *
 * This is deliberately NOT `cadenceSeconds`: the poll rate answers "how often
 * should I ask", while this answers "how long may the answer stay the same
 * before that itself is news". For a push-style publication feed there is no
 * cadence to double — a quiet hour means no news, not a broken panel — so it
 * gets an explicit quiet tolerance. Everything else keeps the 2× rule that
 * DESIGN_BRIEF §6 sets for cameras, which is the conservative default.
 *
 * The asymmetry is intentional: a false "stale" badge on a healthy quiet feed
 * trains the user to ignore the badge, which costs more than the badge is
 * worth. A missed badge on a genuinely dead feed is what this threshold must
 * never do, which is why the push-style entries are hours, not days.
 *
 * The rungs are ordered by how fast the underlying data really changes, and
 * the ordering is asserted in honesty.test.ts: a strictly increasing ladder is
 * the difference between a considered threshold and a pile of magic numbers.
 */
export function quietSeconds(cadence: string | undefined): number {
  const c = cadence ?? "";
  // Push-style: the publisher decides when there is news. news.gov.hk's seven
  // category feeds and TD's special-traffic notices are all "as issued"; the
  // feed rebuilds hourly even when it has nothing new to say (MEASURED: the
  // 治安 channel's lastBuildDate was 2 minutes old while its newest article
  // was 27 hours old — so feed freshness carries no information here).
  //
  // 24h, chosen by Cyrus 2026-09-24: it covers a normal overnight-plus-weekend
  // gap, while a full day of silence in a feed that normally publishes daily
  // IS worth flagging, because that is the shape a real outage takes.
  if (/continuous|as issued|real-time|即時|on update|irregular|varies|periodic|when necessary/i.test(c))
    return 86_400;
  // "As and when there is a change to the address or working hours of Immigration
  // offices" (ck_hk_immd_set2_address_and_working_hours_of_office) is the same
  // promise written as prose: the publisher updates it when the fact changes,
  // which for an office address could be years. MEASURED 2026-09-24: it was
  // reaching the bare 600s default, so a permanent reference document was being
  // judged on a 10-minute clock. It belongs on the reference rung, not the news
  // one — an office address that is a year old is still correct, whereas a news
  // feed silent for a day is worth a second look.
  if (/as and when|when there is a change/i.test(c)) return 90 * 86_400;
  // Reference data: changes on a schedule longer than any session, and a
  // snapshot boundary is not a latency. These sit ABOVE the push-style feeds
  // because a reference layer that changed last year is still correct today,
  // whereas a news feed that has said nothing for a day is worth a second look.
  if (/snapshot|static|manual/i.test(c)) return 90 * 86_400;
  if (/weekly/i.test(c)) return 180 * 86_400;
  if (/monthly|half-yearly|quarterly/i.test(c)) return 400 * 86_400;
  // A decennial dataset is the slowest thing in the registry and must not
  // share a window with an annual one — the ladder has to stay strictly
  // increasing or the ordering assertion (and the idea behind it) is false.
  if (/annual|yearly/i.test(c)) return 800 * 86_400;
  if (/decennial/i.test(c)) return 3650 * 86_400;
  return cadenceSeconds(c) * 2;
}
