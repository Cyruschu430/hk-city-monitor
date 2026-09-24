// HK City Monitor Worker — the project's only server-side piece.
//
// Jobs (AGENTS.md Run 1, SECURITY.md §4, COST.md §4):
//   1. CORS proxy for sources.json entries whose "fetch" is "proxy"
//   2. target-host whitelist — refuse anything not in the registry (no open proxy)
//   3. per-IP rate limit + edge cache — the LandsD terms forbid request bursts,
//      and getting blocked is the one real outage risk (COST.md §2)
//   4. inject the Open3Dhk tileset URLs server-side, so the front end never
//      hardcodes them (PRIMITIVES.md §0.00, the HomeCheck ~/.tiles3d_url pattern)
//
// GET only. Never forwards client cookies or credentials upstream.

import WHITELIST from "./whitelist.generated.js";

const ALLOWED_HOSTS = new Set(WHITELIST);

const UA = "hk-city-monitor/0.2 (+https://github.com/Cyruschu430/hk-city-monitor)";
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_UPSTREAM_BYTES = 16 * 1024 * 1024; // 16 MiB, checked via Content-Length when present

// Edge-cache lifetimes. Data payloads: 60s collapses simultaneous users onto one
// origin fetch while staying far inside every source cadence (fastest is 15 min).
// Tiles/imagery: 24h — the cache exists so a popular day cannot turn into a
// request burst at LandsD (COST.md: "tile cache 係安全措施，唔係效能優化").
const DATA_CACHE_SECONDS = 60;
const TILE_CACHE_SECONDS = 86_400;

// Rate limits per client IP.
//
// WHAT MUST BE BOUNDED IS ORIGIN TRAFFIC, NOT REQUESTS. A cache HIT costs the
// upstream publisher nothing, so counting hits against a rate limit protects
// nobody and throttles our own users.
//
// MEASURED 2026-09-24: a single cold load of the dashboard issued **49 proxy
// requests in 30s (96.6/min)** against a 60/min limit. The app was over budget by
// 1.6x before the user did anything, because the panel engine, the map layers and
// the news ticker all read overlapping sources within the same 60s cache window —
// every one of those reads was a cache HIT, and every one was counted. The symptom
// was intermittent panels failing with 429 on a loaded minute.
//
// The tile limiter already had this right (it counts misses after the cache
// check). These constants make the same distinction for data:
//   · DATA_MISS_LIMIT_PER_MIN  — the real LandsD/upstream protection, unchanged.
//   · DATA_TOTAL_LIMIT_PER_MIN — a generous ceiling so a client hammering cached
//     hits is still bounded, without penalising normal use.
const DATA_MISS_LIMIT_PER_MIN = 60;
const DATA_TOTAL_LIMIT_PER_MIN = 600;
const TILE_MISS_LIMIT_PER_MIN = 120;
// Tiles are cached for 24h, so a hit is a pure CDN read; panning a map legitimately
// asks for a burst of them. This ceiling only exists to bound the Workers request
// budget, not to model upstream load, so it is deliberately loose.
const TILE_TOTAL_LIMIT_PER_MIN = 1200;

// --- rate limiter ------------------------------------------------------------
// Ceiling: this bucket is per-isolate in-memory state, so it is best-effort —
// Cloudflare may run many isolates and a determined abuser gets limit × isolates.
// Upgrade path: a Durable Object counter or the Cloudflare rate-limiting binding,
// both of which need a deployed account (out of scope tonight). The edge cache is
// the real LandsD protection; this limiter is the abuse tripwire.
const buckets = new Map(); // key -> { count, resetAt }

function isLimited(key, limit, now) {
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + 60_000 };
    buckets.set(key, b);
  }
  b.count += 1;
  // Lazy eviction so a flood of distinct IPs cannot grow the map without bound.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    if (buckets.size > 10_000) buckets.clear();
  }
  return b.count > limit;
}

// --- helpers -----------------------------------------------------------------

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "86400",
    ...extra,
  };
}

function jsonError(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: corsHeaders({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

function json(data, cacheSeconds = DATA_CACHE_SECONDS) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: corsHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${cacheSeconds}`,
    }),
  });
}

const TILE_PATH_RE = /\.(png|jpe?g|webp|pbf|mvt|b3dm|i3dm|pnts|cmpt)(\?|$)/i;

function isTileLike(url, contentType) {
  if (TILE_PATH_RE.test(url.pathname)) return true;
  const ct = (contentType || "").toLowerCase();
  return ct.startsWith("image/") || ct === "application/octet-stream";
}

// --- routes ------------------------------------------------------------------

async function handleProxy(request, ctx) {
  const now = Date.now();
  const clientIp = request.headers.get("CF-Connecting-IP") || "local";

  const raw = new URL(request.url).searchParams.get("url");
  if (!raw) return jsonError(400, "missing_url", "GET /proxy?url=<url-encoded target>");

  let target;
  try {
    target = new URL(raw);
  } catch {
    return jsonError(400, "bad_url", "url parameter is not a valid URL");
  }
  // HTTPS only: proxying plain HTTP would let this worker reach internal network
  // services on deployment. Credentials-in-URL are refused for the same reason.
  if (target.protocol !== "https:") {
    return jsonError(400, "https_only", "only https:// targets are proxied");
  }
  if (target.username || target.password) {
    return jsonError(400, "bad_url", "credentials in URL are not allowed");
  }
  if (!ALLOWED_HOSTS.has(target.host.toLowerCase())) {
    return jsonError(403, "host_not_allowed", `host not in sources.json registry: ${target.host}`);
  }

  const tile = TILE_PATH_RE.test(target.pathname);

  // A generous ceiling on TOTAL requests, so a client hammering the cache is still
  // bounded. This is NOT the upstream protection — that is the miss limit below.
  const totalKey = tile ? `t:${clientIp}` : `d:${clientIp}`;
  const totalLimit = tile ? TILE_TOTAL_LIMIT_PER_MIN : DATA_TOTAL_LIMIT_PER_MIN;
  if (isLimited(totalKey, totalLimit, now)) {
    return jsonError(429, "rate_limited", "too many requests — retry in a minute");
  }

  const cache = caches.default;
  const cacheKey = new Request(target.toString(), { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set("X-HKCM-Cache", "HIT");
    for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
    return new Response(hit.body, { status: hit.status, headers });
  }

  // Past this point we are about to touch the upstream, so the real limit applies.
  // Counting only MISSES is what stops the dashboard from throttling itself: see
  // the note on DATA_MISS_LIMIT_PER_MIN.
  if (tile && isLimited(`tm:${clientIp}`, TILE_MISS_LIMIT_PER_MIN, now)) {
    return jsonError(429, "rate_limited", "too many uncached tile requests — retry in a minute");
  }
  if (!tile && isLimited(`dm:${clientIp}`, DATA_MISS_LIMIT_PER_MIN, now)) {
    return jsonError(429, "rate_limited", "too many uncached upstream requests — retry in a minute");
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      method: "GET",
      headers: { "User-Agent": UA, Accept: request.headers.get("Accept") || "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err && (err.name === "TimeoutError" || err.name === "AbortError");
    // Server-side only: the client gets a generic code, the operator gets the
    // real reason in `wrangler tail` / the dashboard. Without this a 502 from a
    // legacy-TLS or DNS failure is indistinguishable from any other.
    console.error(`proxy upstream failed: ${target.host}${target.pathname} — ${err && (err.message || err.name)}`);
    return jsonError(timeout ? 504 : 502, timeout ? "upstream_timeout" : "upstream_error",
      timeout ? "upstream did not answer in time" : "upstream fetch failed");
  }

  const length = Number(upstream.headers.get("content-length") || 0);
  if (length > MAX_UPSTREAM_BYTES) {
    return jsonError(413, "upstream_too_large", `upstream is ${length} bytes, limit is ${MAX_UPSTREAM_BYTES}`);
  }

  const longCache = tile || isTileLike(target, upstream.headers.get("Content-Type"));
  const seconds = longCache ? TILE_CACHE_SECONDS : DATA_CACHE_SECONDS;

  const headers = new Headers();
  for (const h of ["Content-Type", "Last-Modified", "ETag"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Set-Cookie from upstream is deliberately NOT forwarded: this proxy must not
  // become a session relay. Our own Cache-Control governs the edge cache.
  headers.set("Cache-Control", `public, max-age=${seconds}`);
  for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);

  if (upstream.status === 200) {
    headers.set("X-HKCM-Cache", "MISS");
    const store = new Response(upstream.body, { status: 200, headers });
    // waitUntil keeps the response streaming to the client while the edge write lands.
    if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, store.clone()));
    return store;
  }

  // Upstream errors are passed through but never cached.
  headers.set("X-HKCM-Cache", "SKIP");
  headers.set("X-HKCM-Upstream-Status", String(upstream.status));
  return new Response(upstream.body, { status: upstream.status, headers });
}

function handleConfig3d(env) {
  const wgs84 = {
    building: env.TILES3D_BUILDING_URL,
    infrastructure: env.TILES3D_INFRASTRUCTURE_URL,
    tilemodel: env.TILES3D_TILEMODEL_URL,
  };
  if (!wgs84.building || !wgs84.infrastructure || !wgs84.tilemodel) {
    return jsonError(503, "config_missing", "TILES3D_* URLs are not configured server-side");
  }
  return json({ wgs84 }, DATA_CACHE_SECONDS);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== "GET") {
      return jsonError(405, "method_not_allowed", "GET only — this is not a general-purpose proxy");
    }

    switch (url.pathname) {
      case "/health":
        return json({ ok: true, version: env.WORKER_VERSION || "dev", whitelistHosts: ALLOWED_HOSTS.size }, 0);
      case "/config/3d":
        return handleConfig3d(env);
      case "/proxy":
        return handleProxy(request, ctx);
      default:
        return jsonError(404, "not_found", "routes: /proxy?url=…, /config/3d, /health");
    }
  },
};
