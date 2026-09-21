// trigger.ts — PRIMITIVES §4. A PURE function: (state, verticals) → the
// vertical id that should auto-activate, or null. No fetch, no LLM, no side
// effects: hoisting signals and rainstorm warnings are life-safety
// information and must be auditable, testable and explainable.
//
// Condition syntax is the closed set from PRIMITIVES §3 — exists / >= / <= /
// == / in. The validator refuses anything else, so an unknown op here is a
// loud non-match (false), never an inventive guess.

export type Op = "exists" | ">=" | "<=" | "==" | "in";

export interface Cond {
  source: string;
  field: string;
  op: Op;
  value?: unknown;
}

export interface VerticalDef {
  id: string;
  priority?: number;
  trigger: { any?: Cond[]; all?: Cond[] } | null;
  [k: string]: unknown;
}

/** State is a plain object keyed by source id:
    { hko_warnsum: { TC8: {...} }, wsd_water_suspension: { records: [...] } } */
export type State = Record<string, unknown>;

/** Resolve a dot path ("a.b.0.c") inside an already-fetched source payload. */
export function getPath(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const key of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function test(cond: Cond, state: State): boolean {
  const v = getPath(state[cond.source], cond.field);
  switch (cond.op) {
    case "exists":
      // An empty object means "no warning in force" for HKO feeds — {} is the
      // absence of the thing, not its presence (TECH_SPEC: warnsum returns {}
      // when nothing is in force; that is normal, not a trigger).
      if (v === null || v === undefined) return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === "object") return Object.keys(v as object).length > 0;
      return true;
    case ">=":
      return typeof v === "number" && typeof cond.value === "number" && v >= cond.value;
    case "<=":
      return typeof v === "number" && typeof cond.value === "number" && v <= cond.value;
    case "==":
      return v === cond.value;
    case "in":
      return Array.isArray(cond.value) && cond.value.includes(v);
    default:
      return false;
  }
}

function fires(trigger: VerticalDef["trigger"], state: State): boolean {
  if (!trigger) return false;
  const any = trigger.any ?? [];
  const all = trigger.all ?? [];
  if (any.length === 0 && all.length === 0) return false;
  return (any.length > 0 && any.some((c) => test(c, state))) ||
    (all.length > 0 && all.every((c) => test(c, state)));
}

/**
 * @returns the id of the vertical that should auto-activate, or null.
 * Multiple matches → highest `priority`; a tie → verticals.json order (the
 * array order is the written-down tiebreak, PRIMITIVES §4).
 */
export function activeVertical(state: State, verticals: readonly VerticalDef[]): string | null {
  let best: { id: string; priority: number } | null = null;
  for (const v of verticals) {
    if (!fires(v.trigger, state)) continue;
    const p = v.priority ?? 0;
    // Strictly greater keeps the FIRST in array order on a tie — intentional.
    if (!best || p > best.priority) best = { id: v.id, priority: p };
  }
  return best?.id ?? null;
}
