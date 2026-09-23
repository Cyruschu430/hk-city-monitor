// config.ts — the only environment the front end reads.
// VITE_WORKER_BASE is a BUILD-TIME value (Vite inlines VITE_*): the same
// bundle cannot secretly switch backends at runtime. Empty means "no worker
// configured" — proxy-only sources then fail loudly into their error state
// instead of silently trying an open relay.

// `import.meta.env` is Vite's, not JavaScript's. scripts/collect_baselines.mjs runs
// the same modules under plain Node, where reading it throws before anything else
// can load — so the read is guarded. Vite still inlines the literal at build time.
export const WORKER_BASE = (
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_WORKER_BASE ?? ""
).replace(/\/+$/, "");

export function hasWorker(): boolean {
  return WORKER_BASE.length > 0;
}

/** Route an absolute URL through the Worker's whitelist proxy. */
export function proxied(url: string): string {
  if (!hasWorker()) {
    throw new Error("此數據源需要 Worker 代理，但未設定 VITE_WORKER_BASE");
  }
  return `${WORKER_BASE}/proxy?url=${encodeURIComponent(url)}`;
}

/** Refresh floor: never poll faster than this, whatever a cadence says —
    the Worker edge-caches data for 60s, so faster polling buys nothing. */
export const MIN_REFRESH_MS = 60_000;

/** Map defaults: Hong Kong, city scale. */
export const HK_CENTER: [number, number] = [114.1694, 22.3193];
export const HK_ZOOM = 10.4;
