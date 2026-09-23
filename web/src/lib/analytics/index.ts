// analytics/index.ts — the Tier 0-4 orchestrator.
//
// Runs the deterministic pipeline over whatever trigger state the panels have
// produced, and returns a Brief. Called from the app on a timer, NOT from
// inside a panel adapter: analysis is a view over state that already exists,
// and putting it in an adapter would make it a data source instead of a
// conclusion drawn from data sources.
//
// This is the ONLY place the tiers are joined. Keeping the join in one file is
// what lets each tier stay a pure, separately-tested module.

import { evaluate, signalKey, type RuleDef, type Event } from "./rules.ts";
import { findConvergence, type Convergence, type ConvergenceOpts, DEFAULT_CONVERGENCE } from "./convergence.ts";
import { observe, emptyStore, type BaselineStore } from "./baseline.ts";
import { templateBrief, type Brief } from "./narrative.ts";

export interface AnalysisInput {
  state: Record<string, unknown>;
  rules: readonly RuleDef[];
  /** persisted baseline store (from data/baselines.json, or an in-memory store) */
  store: BaselineStore;
  now: Date;
  convergence?: ConvergenceOpts;
  lang: "tc" | "en";
}

export interface AnalysisOutput {
  brief: Brief;
  events: Event[];
  convergences: Convergence[];
  /** the store AFTER folding this run's observations — caller persists it */
  store: BaselineStore;
}

/**
 * Which numeric signals to fold into the baseline on each run.
 *
 * Only signals with a MEANINGFUL CONTINUOUS VALUE belong here. A boolean-ish
 * signal (a warning being in force) has no useful distribution, and folding it
 * would produce a baseline that says "warnings are usually 0", which fires an
 * anomaly on every single warning — technically correct, useless in practice.
 */
const BASELINE_SIGNALS: { source: string; field: string }[] = [
  { source: "ha_ae_waiting", field: "longestWaitMin" },
  { source: "immd_cp_queue", field: "maxQueueMin" },
  { source: "aqhi_city_dashboard", field: "maxAqhi" },
  { source: "ck_hk_hko_rss_latest_ten_minute_wind_info", field: "maxSpeedKmh" },
];

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** Fold this run's observations into the store (Tier 0 update step). */
export function updateBaselines(store: BaselineStore, state: Record<string, unknown>, now: Date): BaselineStore {
  let next = store;
  for (const sig of BASELINE_SIGNALS) {
    const payload = state[sig.source];
    if (payload === undefined || payload === null || typeof payload !== "object") continue;
    const v = numeric((payload as Record<string, unknown>)[sig.field]);
    // A null reading (no data, closed station) is NOT an observation of zero —
    // folding it would drag the baseline down and manufacture a spike later.
    if (v === null) continue;
    next = observe(next, `${sig.source}.${sig.field}`, v, now);
  }
  return next;
}

export function analyse(input: AnalysisInput): AnalysisOutput {
  const { events, immature } = evaluate(input.rules, {
    state: input.state,
    store: input.store,
    now: input.now,
  });
  const convergences = findConvergence(events, input.convergence ?? DEFAULT_CONVERGENCE);
  // The brief cites the rules that are still accumulating, keyed by SOURCE so
  // one source is not listed once per rule watching it.
  const immatureBySource = immature.map((i) => ({ ruleId: i.ruleId, source: i.source, maturity: i.maturity }));
  const brief = templateBrief(events, convergences, immatureBySource, input.now, input.lang);
  const store = updateBaselines(input.store, input.state, input.now);
  return { brief, events, convergences, store };
}

export { emptyStore, signalKey };
export type { BaselineStore, Brief, Event, Convergence, RuleDef };
