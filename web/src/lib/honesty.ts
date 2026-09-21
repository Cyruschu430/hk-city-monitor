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
 * Cadence-aware freshness: amber after 2× the source cadence, "red" (the
 * stale state's stronger form) after 5× (DESIGN_BRIEF §6 thresholds for
 * cameras). A fetch failure is always an immediate error for warnings and
 * market data — that decision lives in the panel engine, which calls errored().
 */
export function degrade(h: Honesty, cadenceSeconds: number, now = new Date()): Honesty {
  if (h.state !== "live" || !h.updatedAt) return h;
  const age = (now.getTime() - h.updatedAt.getTime()) / 1000;
  if (age > cadenceSeconds * 2) return { state: "stale", updatedAt: h.updatedAt };
  return h;
}

/** Parse the cadence strings in sources.json ("5 minutes", "15 minutes",
    "every 2 minutes", "as issued") into seconds. Defaults to 5 minutes — the
    modal cadence in the registry — for anything unparseable, and 10 minutes
    for "as issued" sources (there is no cadence to double, so pick the
    slowest common one rather than flashing stale on a quiet day). */
export function cadenceSeconds(cadence: string | undefined): number {
  if (!cadence) return 300;
  const m = /(\d+)\s*(minute|min|hour|second|sec)/i.exec(cadence);
  if (!m) return /as issued|real-time|即時/i.test(cadence) ? 600 : 300;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  if (unit.startsWith("hour")) return n * 3600;
  if (unit.startsWith("sec")) return n;
  return n * 60;
}
