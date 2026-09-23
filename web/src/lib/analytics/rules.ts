// analytics/rules.ts — Tier 1: the anomaly rule engine.
//
// ANALYTICS.md Tier 1. Rules live in data/rules.json, not in code: adding a
// rule is a config change. This module only evaluates them.
//
// NO LLM, EVER, ON THIS PATH. A rule firing produces a structured event with
// the numbers that caused it, so any claim on screen can be traced back to a
// value and a threshold. The narrative step (Tier 3) is allowed to word these
// events; it is never allowed to decide them.
//
// The ops are a CLOSED SET, mirroring the trigger engine's discipline. An
// unknown op is a loud non-match, never a guess.

import { baselineFor, zScore, maturity, type BaselineStore, type Maturity } from "./baseline.ts";

export type RuleOp = ">=" | "<=" | ">" | "<" | "==" | "!=" | ">baseline" | "<baseline";

/** Ops that require a baseline to be meaningful (and therefore maturity). */
const BASELINE_OPS: ReadonlySet<string> = new Set([">baseline", "<baseline"]);

export interface RuleWhen {
  /** registry source id the value comes from */
  source: string;
  /** dot path into that source's trigger state, e.g. "records.length" */
  field: string;
  op: RuleOp;
  /** numeric threshold, or the number of SDs for the baseline ops */
  value?: number;
}

export interface RuleDef {
  id: string;
  /** which vertical/domain this belongs to — Tier 2 groups by this */
  domain: string;
  severity: 1 | 2 | 3;
  when: RuleWhen;
  headline: { tc: string; en: string };
  /** optional: the official district the event belongs to, for Tier 2 */
  district_field?: string;
  /** include this rule's events in Tier 2 convergence (default true) */
  converge?: boolean;
}

export interface Event {
  ruleId: string;
  domain: string;
  severity: 1 | 2 | 3;
  headline: { tc: string; en: string };
  /** the observed value and the threshold it crossed — the traceability pair */
  observed: number;
  threshold: number;
  /** district name when the rule declares one, else null */
  district: string | null;
  at: Date;
  /** true when this fired on a baseline comparison rather than a fixed number */
  baselineAware: boolean;
  /** z-score when baseline-aware, else null */
  z: number | null;
}

/** Read a numeric value at a dot path, supporting `.length` on arrays and
 *  objects. Returns null when the path does not resolve to a finite number —
 *  a missing value is never treated as 0, which would fire ">= 0" rules on
 *  every absent source. */
export function numericAt(root: unknown, path: string): number | null {
  let cur: unknown = root;
  for (const key of path.split(".")) {
    if (cur === null || cur === undefined) return null;
    if (key === "length") {
      if (Array.isArray(cur)) return cur.length;
      if (typeof cur === "object") return Object.keys(cur as object).length;
      return null;
    }
    if (typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  if (typeof cur === "number" && Number.isFinite(cur)) return cur;
  // A numeric string is common in these government feeds ("18", "99").
  if (typeof cur === "string" && cur.trim() !== "" && Number.isFinite(Number(cur))) return Number(cur);
  return null;
}

function readDistrict(root: unknown, field: string | undefined): string | null {
  if (!field) return null;
  let cur: unknown = root;
  for (const key of field.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "string" && cur.trim() ? cur : null;
}

export interface EvaluateOpts {
  state: Record<string, unknown>;
  store: BaselineStore;
  now: Date;
}

export interface RuleResult {
  events: Event[];
  /** rules skipped because their signal is not yet mature (surfaced honestly) */
  immature: { ruleId: string; source: string; maturity: Maturity }[];
}

/**
 * Evaluate every rule against the current state. PURE: no fetch, no clock read
 * (the caller passes `now`), no mutation of inputs.
 *
 * A rule whose source is absent from `state` is SKIPPED, not failed — the feed
 * simply has not answered yet, and inventing a value would be the bug.
 */
export function evaluate(rules: readonly RuleDef[], opts: EvaluateOpts): RuleResult {
  const events: Event[] = [];
  const immature: RuleResult["immature"] = [];

  for (const rule of rules) {
    const payload = opts.state[rule.when.source];
    if (payload === undefined || payload === null) continue;

    const observed = numericAt(payload, rule.when.field);
    if (observed === null) continue;

    let threshold: number;
    let fired: boolean;
    let baselineAware = false;
    let z: number | null = null;

    if (BASELINE_OPS.has(rule.when.op)) {
      const b = baselineFor(opts.store, signalKey(rule), opts.now);
      if (b === null) {
        // THE GATE. Not mature → this rule cannot fire, and the caller is told
        // so it can render "累積中 · 已 X 日 / 14 日" instead of silence.
        immature.push({ ruleId: rule.id, source: rule.when.source, maturity: maturity(opts.store, signalKey(rule)) });
        continue;
      }
      baselineAware = true;
      z = zScore(observed, b);
      threshold = rule.when.value ?? 2;
      fired = rule.when.op === ">baseline" ? z >= threshold : z <= -threshold;
    } else {
      threshold = rule.when.value ?? 0;
      fired =
        rule.when.op === ">=" ? observed >= threshold :
        rule.when.op === "<=" ? observed <= threshold :
        rule.when.op === ">" ? observed > threshold :
        rule.when.op === "<" ? observed < threshold :
        rule.when.op === "==" ? observed === threshold :
        observed !== threshold;
    }

    if (!fired) continue;

    events.push({
      ruleId: rule.id,
      domain: rule.domain,
      severity: rule.severity,
      headline: rule.headline,
      observed,
      threshold,
      district: readDistrict(payload, rule.district_field),
      at: opts.now,
      baselineAware,
      z,
    });
  }

  // Highest severity first; ties keep config order (the written-down tiebreak,
  // same convention as the trigger engine). Two distinct rules on the same
  // source/field are deliberately BOTH kept: they asked different questions
  // (e.g. a fixed threshold and a baseline deviation), and collapsing them
  // would hide that both fired.
  events.sort((a, b) => b.severity - a.severity);
  return { events, immature };
}

/** Baseline buckets are keyed per RULE, not per source: two rules watching
 *  different fields of one source have genuinely different distributions. */
export function signalKey(rule: RuleDef): string {
  return `${rule.when.source}.${rule.when.field}`;
}
