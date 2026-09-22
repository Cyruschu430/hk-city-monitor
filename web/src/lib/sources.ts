// sources.ts — the source registry as DATA (PRIMITIVES §0: registries are
// JSON, not classes). Knows two things: how to reach a source (browser-direct
// vs the Worker proxy, per the registry's own `fetch` field), and how to
// template its URL (a probed URL may carry a sample date — TECH_SPEC notes
// the HKIA feed takes today, radar filenames take the current minute).

import { proxied } from "../config.ts";
import { hkToday } from "./format.ts";

export interface SourceDef {
  id: string;
  group?: string;
  name: string;
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
}

/** Some probed URLs embed a sample date ("date=2026-09-18"); the app always
    asks for today in Hong Kong time. */
export function resolveUrl(src: SourceDef): string {
  let url = src.url;
  if (src.id === "hkia_flights") {
    url = url.replace(/date=\d{4}-\d{2}-\d{2}/, `date=${hkToday()}`);
    // arrivals feed answers the resident question (接機); cargo adds noise.
    if (!/arrival=/.test(url)) url += "&arrival=true&cargo=false";
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
  const [panelsJ, verticalsJ, layersJ, sourcesJ] = await Promise.all([
    fetch("data/panels.json").then((r) => r.json()),
    fetch("data/verticals.json").then((r) => r.json()),
    fetch("data/layers.json").then((r) => r.json()),
    fetch("data/sources.json").then((r) => r.json()),
  ]);
  const sources: SourceDef[] = sourcesJ.sources;
  return {
    panels: panelsJ.panels,
    verticals: verticalsJ.verticals,
    layers: layersJ.layers,
    sources,
    byId: new Map(sources.map((s) => [s.id, s])),
  };
}
