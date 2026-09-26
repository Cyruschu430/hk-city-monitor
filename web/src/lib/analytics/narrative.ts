// analytics/narrative.ts — Tier 3/4: wording, and the template fallback.
//
// ANALYTICS.md Tier 3/4. THE RULE THAT SHAPES THIS FILE: the LLM may only
// RESTATE facts the deterministic tiers produced. It never decides whether an
// event exists (Tier 1 did that), never scores a convergence (Tier 2 did that),
// and never adds context it was not given.
//
// The fallback is not a nicety. If the narrative step fails — no key, timeout,
// rate limit, provider outage — the feature must still work. So the TEMPLATE is
// the primary implementation here, and the LLM is an optional decoration on
// top. That ordering matters: it means the code path that always runs is the
// one with no external dependency, and a template brief is what ships if
// nothing else does.
//
// There is NO LLM CALL IN THIS FILE. Tier 3/4 runs in the cron collector (see
// the roadmap), writes data/analysis.json, and the browser only reads it. This
// module builds the JSON and the template text, which is exactly the part that
// must be testable offline.

import type { Event } from "./rules.ts";
import type { Convergence } from "./convergence.ts";
import { describeConvergence, convergenceBand } from "./convergence.ts";
import type { Maturity } from "./baseline.ts";

export interface NarrativeFact {
  /** the deterministic claim, in both languages */
  text: { tc: string; en: string };
  /** rule id that produced it — every sentence traces to a rule */
  ruleId?: string;
  severity?: 1 | 2 | 3;
  /** observed value and threshold, kept so a reader can check the claim */
  observed?: number;
  threshold?: number;
  /** registry source ids behind this fact */
  sources: string[];
}

export interface Brief {
  generatedAt: string;
  /** which tier produced the wording */
  mode: "template" | "llm";
  facts: NarrativeFact[];
  /** Tier 2 lines, phrased as co-occurrence */
  convergences: NarrativeFact[];
  /** The SAME Tier 2 result, structured instead of phrased.
   *
   * `convergences` above is what the brief SAYS; this is what it is MADE OF, so a surface can
   * lay it out by district and time rather than as prose. Both are derived from one
   * `Convergence[]` in one function, so they cannot disagree about which groups exist — the
   * failure mode of a second pipeline would be a timeline showing districts the sentence above
   * it does not mention.
   *
   * Times are ISO strings, not Dates: this crosses into ui/ and a Date that has been
   * structurally confused with a string renders as `Invalid Date` with no error anywhere. */
  convergenceDetail: ConvergenceDetail[];
  /** honest statement of what could NOT be said yet */
  accumulating: { signal: string; days: number; required: number }[];
}

/** One event on a district timeline. Every field is copied from the Tier 1 Event that fired —
 *  nothing is recomputed here, so the row and the rule that produced it cannot drift. */
export interface TimelineEvent {
  at: string;
  domain: string;
  severity: 1 | 2 | 3;
  ruleId: string;
  headline: { tc: string; en: string };
  observed: number;
  threshold: number;
}

/** A Tier 2 group, laid out for a timeline: which district, which domains, how bad, and the
 *  events in the order they happened. */
export interface ConvergenceDetail {
  district: string;
  domains: string[];
  score: number;
  maxSeverity: 1 | 2 | 3;
  from: string;
  to: string;
  events: TimelineEvent[];
}

/** The severity wording, so a 3 never renders as "notable". */
const SEVERITY_WORD: Record<1 | 2 | 3, { tc: string; en: string }> = {
  1: { tc: "留意", en: "advisory" },
  2: { tc: "偏高", en: "elevated" },
  3: { tc: "嚴重", en: "critical" },
};

/** Turn one event into a fact. Restates the numbers; never interprets them. */
export function eventToFact(e: Event): NarrativeFact {
  const word = SEVERITY_WORD[e.severity];
  const valueTc = e.baselineAware && e.z !== null
    ? `${e.observed}（基線偏差 ${e.z.toFixed(1)} SD）`
    : `${e.observed}（門檻 ${e.threshold}）`;
  const valueEn = e.baselineAware && e.z !== null
    ? `${e.observed} (${e.z.toFixed(1)} SD from baseline)`
    : `${e.observed} (threshold ${e.threshold})`;
  return {
    text: {
      tc: `${word.tc}：${e.headline.tc}——讀數 ${valueTc}`,
      en: `${word.en}: ${e.headline.en} — reading ${valueEn}`,
    },
    ruleId: e.ruleId,
    severity: e.severity,
    observed: e.observed,
    threshold: e.threshold,
    sources: [e.ruleId],
  };
}

/**
 * Build the brief from template text only.
 *
 * This is what runs when there is no LLM, and it is also the input the LLM is
 * allowed to reword. Everything it says is traceable to a rule id and a pair of
 * numbers.
 */
export function templateBrief(
  events: readonly Event[],
  convergences: readonly Convergence[],
  immature: readonly { ruleId: string; source: string; maturity: Maturity }[],
  now: Date,
  lang: "tc" | "en",
): Brief {
  const facts = events.map(eventToFact);

  const convFacts: NarrativeFact[] = convergences.map((c) => ({
    text: {
      tc: describeConvergence(c, "tc"),
      en: describeConvergence(c, "en"),
    },
    // Convergence is a Tier 2 result; it cites the events that formed it rather
    // than inventing a rule of its own.
    sources: c.events.map((e) => e.ruleId),
  }));

  // Deduplicate signals: several rules can watch one source, and listing it
  // three times would overstate how much is still accumulating.
  const seen = new Map<string, Maturity>();
  for (const i of immature) {
    const prev = seen.get(i.source);
    if (!prev || i.maturity.days > prev.days) seen.set(i.source, i.maturity);
  }
  const accumulating = [...seen.entries()].map(([signal, m]) => ({
    signal,
    days: m.days,
    required: m.required,
  }));

  // Sorted oldest first: a timeline that is not in time order is a list wearing a timeline's
  // name, and the whole point of this view is that the reader can see the sequence.
  const convergenceDetail: ConvergenceDetail[] = convergences.map((c) => ({
    district: c.district,
    domains: c.domains,
    score: c.score,
    maxSeverity: c.maxSeverity,
    from: c.from.toISOString(),
    to: c.to.toISOString(),
    events: [...c.events]
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .map((e) => ({
        at: e.at.toISOString(),
        domain: e.domain,
        severity: e.severity,
        ruleId: e.ruleId,
        headline: e.headline,
        observed: e.observed,
        threshold: e.threshold,
      })),
  }));

  void lang; // the fact text carries both languages already
  return {
    generatedAt: now.toISOString(),
    mode: "template",
    facts,
    convergences: convFacts,
    convergenceDetail,
    accumulating,
  };
}

/**
 * The instruction an LLM would be given at Tier 3.
 *
 * Exported so it can be REVIEWED and TESTED rather than living inside a cron
 * script. The prohibitions are the point: restate, do not infer, do not add.
 */
export function narrativePrompt(facts: NarrativeFact[]): string {
  const lines = facts.map((f, i) => `${i + 1}. ${f.text.en}`).join("\n");
  return [
    "You are writing a two-sentence situation summary for a Hong Kong public dashboard.",
    "",
    "RULES — these are not stylistic preferences:",
    "- Only restate the facts in the JSON below. Do not infer causation.",
    "- Do not add context, background, or anything not in the list.",
    "- Never write that one event caused, led to, or is due to another.",
    "- If two things happened at the same time and place, say they co-occurred.",
    "- Keep every number exactly as given. Do not round, convert or summarise them.",
    "",
    "FACTS:",
    lines || "(none)",
  ].join("\n");
}

/** One-line coverage sentence for the brief header. Reports the shortfall
 *  rather than implying the picture is complete. */
export function briefSummary(b: Brief, lang: "tc" | "en"): string {
  const parts: string[] = [];
  if (lang === "tc") {
    parts.push(`${b.facts.length} 項事件`);
    if (b.convergences.length) parts.push(`${b.convergences.length} 組同時發生`);
    if (b.accumulating.length) parts.push(`${b.accumulating.length} 個訊號累積中`);
    parts.push(b.mode === "llm" ? "AI 敘述" : "範本敘述");
  } else {
    parts.push(`${b.facts.length} events`);
    if (b.convergences.length) parts.push(`${b.convergences.length} co-occurring`);
    if (b.accumulating.length) parts.push(`${b.accumulating.length} accumulating`);
    parts.push(b.mode === "llm" ? "AI wording" : "template wording");
  }
  return parts.join(" · ");
}

export { convergenceBand };
