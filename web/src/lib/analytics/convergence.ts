// analytics/convergence.ts — Tier 2: geographic convergence.
//
// ANALYTICS.md Tier 2, described there as the moat. The idea: a single event is
// noise, but independent events in the SAME district inside the SAME hour are
// worth looking at together.
//
// THE WORDING RULE IS THE WHOLE POINT
// This module produces "these happened in the same place at the same time". It
// never produces "because". Correlation between a water suspension and a
// traffic closure may be real or may be coincidence, and a dashboard that
// asserts causation about a city is making a claim it cannot support. Every
// string this module emits is phrased as co-occurrence, and there is no field
// anywhere in the output that could carry a causal claim.
//
// Score is the documented formula, unchanged: domains×3 + maxSeverity×2 + count.

import type { Event } from "./rules.ts";

export interface Convergence {
  district: string;
  /** distinct domains present in the window */
  domains: string[];
  /** the events themselves, each with its rule id and numbers */
  events: Event[];
  /** domains × 3 + max severity × 2 + event count */
  score: number;
  maxSeverity: 1 | 2 | 3;
  /** earliest and latest event times in the group */
  from: Date;
  to: Date;
}

export interface ConvergenceOpts {
  /** window length in minutes (config value — ANALYTICS.md says 60) */
  windowMinutes: number;
  /** minimum distinct domains for a group to count (ANALYTICS.md says 2) */
  minDomains: number;
  /** cap on groups returned, highest score first */
  maxGroups?: number;
}

export const DEFAULT_CONVERGENCE: ConvergenceOpts = { windowMinutes: 60, minDomains: 2, maxGroups: 5 };

/**
 * Group events by district and time window, keeping only groups that span at
 * least `minDomains` distinct domains.
 *
 * Events with no district are EXCLUDED rather than bucketed into a fake
 * "unknown" district: the whole value of Tier 2 is geographic co-location, and
 * an unknown location cannot support that claim.
 *
 * Window semantics: for each district the events are sorted by time and grouped
 * greedily — a group extends while each next event is within `windowMinutes` of
 * the group's FIRST event. That is a fixed window, not a sliding one, so the
 * same input always yields the same grouping (a sliding window would let one
 * event appear in many groups and make the output unstable).
 */
export function findConvergence(
  events: readonly Event[],
  opts: ConvergenceOpts = DEFAULT_CONVERGENCE,
): Convergence[] {
  const byDistrict = new Map<string, Event[]>();
  for (const e of events) {
    if (!e.district) continue;
    const list = byDistrict.get(e.district) ?? [];
    list.push(e);
    byDistrict.set(e.district, list);
  }

  const out: Convergence[] = [];
  for (const [district, list] of byDistrict) {
    const sorted = [...list].sort((a, b) => a.at.getTime() - b.at.getTime());
    let start = 0;
    while (start < sorted.length) {
      const first = sorted[start]!;
      let end = start;
      while (
        end + 1 < sorted.length &&
        sorted[end + 1]!.at.getTime() - first.at.getTime() <= opts.windowMinutes * 60_000
      ) {
        end++;
      }
      const group = sorted.slice(start, end + 1);
      const domains = [...new Set(group.map((e) => e.domain))];

      if (domains.length >= opts.minDomains) {
        const maxSeverity = Math.max(...group.map((e) => e.severity)) as 1 | 2 | 3;
        out.push({
          district,
          domains,
          events: group,
          maxSeverity,
          score: domains.length * 3 + maxSeverity * 2 + group.length,
          from: first.at,
          to: group[group.length - 1]!.at,
        });
      }
      start = end + 1;
    }
  }

  out.sort((a, b) => b.score - a.score || a.district.localeCompare(b.district));
  return opts.maxGroups ? out.slice(0, opts.maxGroups) : out;
}

/**
 * The ONLY phrasing function for this tier.
 *
 * Reads "同一時段內同時發生" / "co-occurring in the same window" and lists the
 * domains. It says WHAT happened together and WHERE — never why.
 */
export function describeConvergence(c: Convergence, lang: "tc" | "en"): string {
  const domains = c.domains.join(lang === "tc" ? "／" : " / ");
  return lang === "tc"
    ? `同一時段內同時發生：${domains}（${c.district}，${c.events.length} 宗）`
    : `Co-occurring in the same window: ${domains} (${c.district}, ${c.events.length} events)`;
}

/** Confidence label from the score. Deliberately coarse: a fine-grained score
 *  would imply a precision this method does not have. */
export function convergenceBand(c: Convergence): "high" | "medium" | "low" {
  if (c.score >= 15) return "high";
  if (c.score >= 9) return "medium";
  return "low";
}
