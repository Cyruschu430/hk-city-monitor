// analytics/baseline.ts — Tier 0: the baseline store.
//
// ANALYTICS.md Tier 0. A pure, deterministic module: same input → same output,
// always. No fetch, no clock read except through an injected `now`, no LLM.
//
// WHY THIS SHAPE
// A "baseline" answers "is this number unusual FOR THIS HOUR ON THIS WEEKDAY".
// Comparing a 08:00 Monday commute against a 03:00 Sunday figure is meaningless,
// so every observation lands in a bucket keyed by (signal, hour-of-day,
// day-of-week) — 7 × 24 = 168 buckets per signal.
//
// THE 14-DAY GATE IS THE POINT
// A bucket with three observations is not a baseline, it is three numbers.
// ANALYTICS.md requires ≥14 days before ANY baseline-derived event may fire, and
// the UI must say "累積中 · 已 X 日 / 14 日" rather than show a confident
// anomaly. Most of this file's surface exists to make that gate impossible to
// bypass by accident: `isMature()` is the only way to get a baseline out.
//
// Storage: plane JSON keyed "signalId|dow|hour". 100 signals × 168 buckets ≈
// 16,800 rows — a few hundred KB, which is why KV/JSON is enough and a database
// would be over-engineering.

/** Running aggregate for one (signal, dow, hour) bucket. */
export interface Bucket {
  /** number of observations folded in */
  n: number;
  sum: number;
  /** sum of squares — kept so variance is computable without storing samples */
  sumSq: number;
  min: number;
  max: number;
  /** ISO timestamp of the most recent observation */
  lastUpdated: string;
}

export interface BaselineStore {
  /** schema version so a future format change can migrate instead of corrupt */
  version: 1;
  /** signal id → "dow|hour" → bucket */
  signals: Record<string, Record<string, Bucket>>;
  /** signal id → ISO date (YYYY-MM-DD, HKT) → how many distinct days seen */
  days: Record<string, string[]>;
}

export const BASELINE_VERSION = 1 as const;
export const MIN_DAYS = 14;

export function emptyStore(): BaselineStore {
  return { version: BASELINE_VERSION, signals: {}, days: {} };
}

/** Hong Kong wall-clock parts of an instant. HKT is UTC+8 with no DST, so the
 *  shift-and-read-UTC trick is exact here (same approach as radarCandidates). */
export function hkParts(at: Date): { date: string; dow: number; hour: number } {
  const hkt = new Date(at.getTime() + 8 * 3_600_000);
  const y = hkt.getUTCFullYear();
  const m = String(hkt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(hkt.getUTCDate()).padStart(2, "0");
  return {
    date: `${y}-${m}-${d}`,
    dow: hkt.getUTCDay(), // 0 = Sunday
    hour: hkt.getUTCHours(),
  };
}

export function bucketKey(dow: number, hour: number): string {
  return `${dow}|${hour}`;
}

function foldInto(b: Bucket, value: number, at: Date): Bucket {
  return {
    n: b.n + 1,
    sum: b.sum + value,
    sumSq: b.sumSq + value * value,
    min: Math.min(b.min, value),
    max: Math.max(b.max, value),
    lastUpdated: at.toISOString(),
  };
}

/**
 * Fold one observation into the store. RETURNS A NEW STORE — the input is never
 * mutated, so a caller can fold a batch and discard it if the write fails, and
 * a test can assert the input is untouched.
 *
 * @param signalId stable id (a source id or a source+field pair)
 * @param value    the numeric observation
 * @param at       when the observation was taken (the PAYLOAD's time, not now)
 */
export function observe(store: BaselineStore, signalId: string, value: number, at: Date): BaselineStore {
  if (!Number.isFinite(value)) {
    // A NaN folded into a sum poisons the bucket forever. Refuse it loudly at
    // the boundary rather than storing a baseline that can never be trusted.
    return store;
  }
  const { date, dow, hour } = hkParts(at);
  const key = bucketKey(dow, hour);

  const signals = { ...store.signals };
  const forSignal = { ...(signals[signalId] ?? {}) };
  const prev = forSignal[key];
  forSignal[key] = prev
    ? foldInto(prev, value, at)
    : { n: 1, sum: value, sumSq: value * value, min: value, max: value, lastUpdated: at.toISOString() };
  signals[signalId] = forSignal;

  // Distinct DAYS, not observations: 500 readings on one day is still one day.
  const days = { ...store.days };
  const seen = days[signalId] ? [...days[signalId]!] : [];
  if (!seen.includes(date)) {
    seen.push(date);
    seen.sort();
  }
  days[signalId] = seen;

  return { version: BASELINE_VERSION, signals, days };
}

export interface Baseline {
  mean: number;
  /** population standard deviation */
  sd: number;
  n: number;
  min: number;
  max: number;
  lastUpdated: string;
}

/** A bucket's summary, or null when the bucket has no observations. */
export function summarise(b: Bucket | undefined): Baseline | null {
  if (!b || b.n === 0) return null;
  const mean = b.sum / b.n;
  // Population variance: E[x²] − E[x]². Guarded against going slightly negative
  // through floating-point cancellation, which would make sd NaN.
  const variance = Math.max(0, b.sumSq / b.n - mean * mean);
  return { mean, sd: Math.sqrt(variance), n: b.n, min: b.min, max: b.max, lastUpdated: b.lastUpdated };
}

/** Distinct days observed for a signal. */
export function daysObserved(store: BaselineStore, signalId: string): number {
  return store.days[signalId]?.length ?? 0;
}

export interface Maturity {
  mature: boolean;
  days: number;
  required: number;
}

/** Whether a signal may produce baseline-derived events. THE gate. */
export function maturity(store: BaselineStore, signalId: string): Maturity {
  const days = daysObserved(store, signalId);
  return { mature: days >= MIN_DAYS, days, required: MIN_DAYS };
}

/**
 * The baseline for a signal at a given instant — or NULL if the signal is not
 * yet mature.
 *
 * Returning null (rather than a baseline plus a flag) is deliberate: the caller
 * physically cannot compute an anomaly score from a null. That is the difference
 * between a rule that must remember to check maturity and a rule that cannot
 * forget.
 */
export function baselineFor(store: BaselineStore, signalId: string, at: Date): Baseline | null {
  if (!maturity(store, signalId).mature) return null;
  const { dow, hour } = hkParts(at);
  return summarise(store.signals[signalId]?.[bucketKey(dow, hour)]);
}

/** Standard score: how many standard deviations from the bucket mean.
 *  Zero sd (a value that never varies) yields 0 rather than Infinity — a
 *  constant signal is not "infinitely anomalous", it is simply constant. */
export function zScore(value: number, b: Baseline): number {
  if (b.sd === 0) return 0;
  return (value - b.mean) / b.sd;
}
