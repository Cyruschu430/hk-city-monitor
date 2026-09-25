// sources.ts — the source registry as DATA (PRIMITIVES §0: registries are
// JSON, not classes). Knows two things: how to reach a source (browser-direct
// vs the Worker proxy, per the registry's own `fetch` field), and how to
// template its URL (a probed URL may carry a sample date — TECH_SPEC notes
// the HKIA feed takes today, radar filenames take the current minute).

import { proxied } from "../config.ts";
import { hkToday } from "./format.ts";
import { lang } from "./i18n.ts";
import { windLattice } from "./windgrid.ts";

export interface SourceDef {
  id: string;
  group?: string;
  name: string;
  /** The publisher's English name.
   *
   * MEASURED 2026-09-25: the registry had NO English names, so in EN mode every
   * panel footer and every layer note showed a Chinese source name — the single
   * largest reason the English UI was incomplete (22 chrome strings surviving a
   * language switch, measured by web/scripts/probe-en-audit.mjs). Added for all
   * 175 entries in sources.json. Optional in the TYPE because the registry is
   * fetched at runtime and a missing value must degrade to the Chinese name
   * rather than render `undefined`, but validate_config.py checks that every
   * entry has one, so an omission fails the build rather than reaching a user.
   */
  name_en?: string;
  /** The same feed in English, where the publisher runs one.
   *
   * MEASURED 2026-09-25: RTHK and news.gov.hk each publish their news in BOTH
   * official languages from the same section, so this is one source with two
   * renderings — the same principle as name/name_en, not two sources that could
   * drift apart. Verified individually: all twelve return 20 items.
   *
   * This matters because the ticker is a TICKER: with only the Chinese feed, the
   * English UI showed 71 Chinese headlines in a strip the user reads continuously.
   * Translating a headline would be inventing editorial copy; pointing at the
   * publisher's own English edition is not. */
  url_en?: string;
  type: string;
  url: string;
  auth?: string;
  cadence?: string;
  fetch: "browser" | "proxy" | "n/a";
  notes?: string;
  candidates?: string[];
  todo?: boolean;
}

export interface Registry {
  panels: PanelDefRaw[];
  verticals: VerticalDefRaw[];
  layers: LayerDefRaw[];
  sources: SourceDef[];
  byId: Map<string, SourceDef>;
  /** Tier 1 rules from data/rules.json; empty when that file cannot load. */
  rules?: unknown[];
}

export interface PanelDefRaw {
  id: string;
  source: string;
  render: string;
  title: { tc: string; en: string };
  params?: Record<string, unknown>;
  cadence_note: { tc: string; en: string };
}

export interface VerticalDefRaw {
  id: string;
  name: { tc: string; en: string };
  question: { tc: string; en: string };
  priority?: number;
  trigger: unknown;
  panels: string[];
  layers: string[];
  window: string;
  location_scope: string;
  order: string[];
}

export interface LayerDefRaw {
  id: string;
  source: string;
  render: string;
  geom: string;
  title: { tc: string; en: string };
  popup: string | null;
  filters?: Record<string, string>;
  /** Glyph id from map/symbols.ts. A point layer picks its symbology here, so
      "the camera layer uses camera symbols" is a config fact, not a code fact. */
  symbol?: string;
}

/** The publisher's name in the ACTIVE language, falling back to the Chinese one.
 *
 * One helper rather than `lang() === "tc" ? src.name : src.name_en` at each call
 * site: there are five of them (panel footers, layer notes, layer rows, the
 * drawer and the palette) and a sixth added later would silently show Chinese in
 * EN mode — which is exactly how the gap arose in the first place. The fallback
 * is deliberate: the registry is fetched at runtime, so a missing `name_en` must
 * render the Chinese name rather than the string "undefined".
 */
export function sourceLabel(src: SourceDef | undefined, fallback = ""): string {
  if (!src) return fallback;
  return (lang() === "tc" ? src.name : src.name_en) || src.name || fallback;
}

/** Some probed URLs embed a sample date ("date=2026-09-18"); the app always
    asks for today in Hong Kong time. */
export function resolveUrl(src: SourceDef): string {
  // The publisher's own edition for the active language, when there is one.
  let url = (lang() === "en" && src.url_en) || src.url;
  if (src.id === "hkia_flights") {
    url = url.replace(/date=\d{4}-\d{2}-\d{2}/, `date=${hkToday()}`);
    // arrivals feed answers the resident question (接機); cargo adds noise.
    if (!/arrival=/.test(url)) url += "&arrival=true&cargo=false";
  }
  // A generated lattice, not a fixed endpoint. The wind-flow layer needs a grid
  // of ~350 coordinates, which is not a URL a human maintains — so the registry
  // holds the TEMPLATE (for traceability, attribution and licence) and the
  // coordinates come from lib/windgrid.ts, the single place that defines the
  // sampling geometry. Same shape as the radar URL's {YYYYMMDDHHMM}.
  if (url.includes("{LATS}") || url.includes("{LONS}")) {
    const { lats, lons } = windLattice();
    url = url.replace("{LATS}", lats).replace("{LONS}", lons);
  }
  return url;
}

/** The URL the app actually requests — direct when the registry says the
    browser may, through the whitelist proxy otherwise. */
export function fetchUrl(src: SourceDef): string {
  const url = resolveUrl(src);
  if (src.fetch === "browser") return url;
  if (src.fetch === "proxy") return proxied(url);
  throw new Error(`source ${src.id} is marked n/a — it is not fetchable at runtime`);
}

/** Memoize proxied payloads 30s by URL. The layer engine and the panel engine
    both fetch the SAME sources (the nowcast CSV is 2.7MB) — without this a
    mode activation issues two concurrent big downloads, which both wastes
    bytes and (measured) trips a content-length mismatch in local workerd. */
const memo = new Map<string, { at: number; response: Response }>();
const MEMO_MS = 30_000;

export function clearDataCache(): void {
  memo.clear();
}

export async function fetchSource(src: SourceDef): Promise<Response> {
  const url = fetchUrl(src);
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.response.clone();
  const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  // The 60s worker edge cache already collapses clients; the 30s memo is only
  // about the same-tab double-fetch (panel + layer), so ttl can be short.
  if (res.ok && src.fetch === "proxy") memo.set(url, { at: Date.now(), response: res.clone() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

export async function loadRegistry(): Promise<Registry> {
  const [panelsJ, verticalsJ, layersJ, sourcesJ, rulesJ] = await Promise.all([
    fetch("data/panels.json").then((r) => r.json()),
    fetch("data/verticals.json").then((r) => r.json()),
    fetch("data/layers.json").then((r) => r.json()),
    fetch("data/sources.json").then((r) => r.json()),
    // Tier 1 rules are config, like every other registry. A failure here must
    // NOT take the dashboard down: analysis is a view over data, and losing it
    // should cost the analysis panel, not the map. So it degrades to an empty
    // rule set and the pipeline simply produces nothing.
    fetch("data/rules.json")
      .then((r) => r.json())
      .catch(() => ({ rules: [] })),
  ]);
  const sources: SourceDef[] = sourcesJ.sources;
  return {
    panels: panelsJ.panels,
    verticals: verticalsJ.verticals,
    layers: layersJ.layers,
    sources,
    byId: new Map(sources.map((s) => [s.id, s])),
    rules: rulesJ.rules ?? [],
  };
}
