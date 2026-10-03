// HK City Monitor Worker — the project's only server-side piece.
//
// Jobs:
//   1. CORS proxy for sources.json entries whose "fetch" is "proxy"
//   2. target-host whitelist — refuse anything not in the registry (no open proxy)
//   3. per-IP rate limit + edge cache — the LandsD terms forbid request bursts,
//      and getting blocked is the one real outage risk
//   4. inject the Open3Dhk tileset URLs server-side, so the front end never
//      hardcodes them (the same pattern used elsewhere in the project)
//
// GET only. Never forwards client cookies or credentials upstream.

import WHITELIST from "./whitelist.generated.js";

const ALLOWED_HOSTS = new Set(WHITELIST);

const UA = "hk-city-monitor/0.2 (+https://github.com/Cyruschu430/hk-city-monitor)";
const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Some upstreams are legitimately slower than the default budget, and 10s turns a
 * request that WOULD have succeeded into a user-visible 504.
 *
 * MEASURED 2026-09-25: `api.open-meteo.com` is asked for a 352-point lattice in a
 * SINGLE query (sources.json `open_meteo_wind_grid`), and it intermittently took
 * longer than 10s. `verify-browser.mjs` captured a real `504 upstream_timeout` for
 * that URL on two consecutive runs, while a standalone probe of the same request
 * answered 200 in a second — so this is a slow spot, not a broken source. The 504
 * left the wind layer un-loaded until the user toggled it off and on again.
 *
 * Deliberately a short explicit list keyed off the TARGET HOST (server-side, never
 * from a client-supplied parameter — that would be an open proxy with extra steps)
 * rather than a longer global budget: 10s stays the rule for every other host, so a
 * genuinely dead upstream still fails fast instead of holding the request.
 *
 * 18s is chosen against the CLIENT, not against Cloudflare's limits: `fetchSource`
 * aborts at 25s (web/src/lib/sources.ts), so anything longer here would be invisible
 * to the user — the browser would have given up first.
 * 18s was raised to 22s on 2026-09-25 after a third gate run still caught a 504 on
 * this URL: 18s left too little headroom for a slow-but-successful answer, and the
 * client's own abort is 25s, so 22s spends the whole budget the user is actually
 * waiting without ever exceeding it.
 */
const SLOW_HOST_TIMEOUT_MS = 22_000;
const SLOW_HOSTS = new Set(["api.open-meteo.com"]);
const MAX_UPSTREAM_BYTES = 16 * 1024 * 1024; // 16 MiB, checked via Content-Length when present

// Edge-cache lifetimes. Data payloads: 60s collapses simultaneous users onto one
// origin fetch while staying far inside every source cadence (fastest is 15 min).
// Tiles/imagery: 24h — the cache exists so a popular day cannot turn into a
// request burst at LandsD (the tile cache is a safety measure, not an optimisation).
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
const TILE_TOTAL_LIMIT_PER_MIN = 600;

// THE REAL CEILING IS THE FREE PLAN'S DAILY REQUEST QUOTA, NOT ANY NUMBER ABOVE.
//
// Cloudflare Workers Free is 100,000 requests per day, and exceeding it returns Error
// 1027 to EVERYONE until midnight UTC — the whole dashboard down, not a bill. Every
// request reaching this Worker spends one of those, cache HIT or MISS alike; the cache
// saves the upstream publisher, not our quota. A cold page load issues about 49 proxy
// requests, so the site's honest capacity is roughly 2,000 cold loads a day.
//
// The limits above are PER ISOLATE and PER IP, so N isolates multiply them, and one
// hostile IP at the old 1,200+600/min could spend the entire daily quota in well under an
// hour. No arithmetic here can fix that: bounding a global quota needs global state, and
// the per-request KV write a counter would need is far outside the free KV tier.
//
// The fix belongs at the edge, not in this file. Add ONE Cloudflare rate-limiting rule
// (free plan): path /proxy, block an IP above ~120 requests/minute. Edge-blocked requests
// never invoke the Worker, so they never spend the quota. See SECURITY.md.
// ponytail: per-isolate tripwire only. A shared counter (Durable Object) is the real fix
// and needs the paid plan, which the project's US$0 budget rules out.

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
    // Evict the oldest live buckets instead of clearing the map. `buckets.clear()` reset
    // the count for whoever was over the limit right now, so a flood of distinct IPs
    // bought everyone a clean slate. Map iterates in insertion order and resetAt only
    // moves forward, so the first entries are the ones that expire soonest.
    if (buckets.size > 10_000) {
      let drop = buckets.size - 10_000;
      for (const k of buckets.keys()) {
        if (drop-- <= 0) break;
        buckets.delete(k);
      }
    }
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

// --- upstream fetch with a re-validated redirect chain ------------------------
//
// MEASURED 2026-09-27: 5 of the 67 registry hosts answer with a 3xx to a host that is
// NOT in the registry (api.adsbdb.com -> www.adsbdb.com, cd.epic.epd.gov.hk ->
// www.epd.gov.hk, es.hkfsd.gov.hk -> hkfsd.gov.hk, rthk.hk -> www.rthk.hk,
// sls.hkpl.gov.hk -> www.hkpl.gov.hk). With `redirect: "follow"` the Worker fetched
// those, and the host check above only ever ran on the URL the CLIENT supplied — so the
// registry was not the boundary it claimed to be.
//
// None of the five is an open redirect, so the destination was not attacker-chosen and
// nothing was exploitable; the fix is not a response to a breach. It is that a boundary
// which one hop can leave is not a boundary, and the next registry host that grows a
// `?url=` redirect turns this into a real SSRF.
//
// `redirect: "manual"` on its own would be wrong the other way: 14 of the 19 redirecting
// hosts point at http->https or apex->www moves that MUST be followed or the source
// breaks. So: follow, up to a cap, re-validating every hop.
const MAX_REDIRECTS = 3;

// A redirect may leave the whitelisted HOST as long as it stays on the same REGISTRABLE
// DOMAIN. That is the line that matters: rthk.hk -> rthk9.rthk.hk is the publisher moving
// you around its own site, rthk.hk -> attacker.net is somebody else's site.
//
// MEASURED 2026-09-27: the obvious rule - "the redirect target must itself be in the
// registry" - broke FIVE live sources. Every RTHK news RSS feed redirects
// rthk.hk/<feed>.xml -> rthk9.rthk.hk in two hops, and rthk9.rthk.hk is not in
// sources.json because nothing links to it directly. The ticker and the breaking-news
// panel read those five feeds.
//
// Suffix list is short and explicit rather than vendoring the full public suffix list:
// these are the suffixes this registry actually contains. An unlisted multi-label suffix
// falls back to the last two labels, which makes the rule STRICTER, never looser - it can
// only refuse a redirect that a full PSL would have allowed.
const TWO_LABEL_SUFFIXES = new Set([
  "gov.hk", "com.hk", "org.hk", "edu.hk", "net.hk",
  "co.uk", "com.au", "co.jp", "com.tw", "com.sg",
]);

function registrableDomain(host) {
  const parts = host.toLowerCase().split(".");
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  return TWO_LABEL_SUFFIXES.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

// An intermediate hop may also be plain http, but ONLY within the same site.
//
// MEASURED 2026-09-27, the actual chain of every RTHK news feed:
//   hop 0  301  https://rthk.hk/<feed>.xml            -> http://rthk9.rthk.hk/<feed>.xml
//   hop 1  302  http://rthk9.rthk.hk/<feed>.xml       -> https://rthk9.rthk.hk/<feed>.xml
//   hop 2  200
// RTHK bounces through an http URL to upgrade itself. Demanding https on every hop
// therefore broke all five news feeds. The registrable-domain check is the real boundary
// here, and it still holds on that hop: an on-path attacker could rewrite the http
// Location, but only to a host on the same site, and the payload they would be rewriting
// is a 302 — the content still arrives over https at hop 2.
//
// A hop that is NOT on the same site gets the strict rule: https, and its host must be in
// the registry. The https-only rule on the CLIENT's own url is unchanged.
async function fetchValidated(startUrl, init, timeoutMs) {
  const startHost = new URL(startUrl).host;
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get("Location");
    if (!loc) return res;
    const next = new URL(loc, current); // throws on an unparseable Location
    const sameSite = registrableDomain(next.host) === registrableDomain(startHost);
    const allowed = sameSite
      ? next.protocol === "https:" || next.protocol === "http:"
      : next.protocol === "https:" && ALLOWED_HOSTS.has(next.host.toLowerCase());
    if (!allowed) {
      throw new Error(`redirect left the registry and the site: ${current} -> ${next.toString()}`);
    }
    current = next.toString();
  }
  throw new Error(`more than ${MAX_REDIRECTS} redirects from ${startUrl}`);
}

// Content-Length is simply absent on a chunked response, so the header check below
// silently passes them through at any size. Count real bytes as they stream.
function capBytes(stream, limit) {
  let seen = 0;
  return stream.pipeThrough(
    new TransformStream({
      transform(chunk, ctrl) {
        seen += chunk.byteLength;
        if (seen > limit) ctrl.error(new Error(`upstream body exceeded ${limit} bytes`));
        else ctrl.enqueue(chunk);
      },
    }),
  );
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
  // The allow-list bounds the host, not the port. A hostile visitor must not be able
  // to reach a non-443 port on a whitelisted host (port scan / weak SSRF).
  if (target.port && target.port !== "443") {
    return jsonError(403, "port_not_allowed", "only the default https port is proxied");
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
    upstream = await fetchValidated(
      target.toString(),
      { method: "GET", headers: { "User-Agent": UA, Accept: request.headers.get("Accept") || "*/*" } },
      SLOW_HOSTS.has(target.host) ? SLOW_HOST_TIMEOUT_MS : UPSTREAM_TIMEOUT_MS,
    );
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
    // The Content-Length check above cannot see a chunked response, so cap the stream too.
    const store = new Response(capBytes(upstream.body, MAX_UPSTREAM_BYTES), { status: 200, headers });
    // waitUntil keeps the response streaming to the client while the edge write lands.
    // A capped stream can error mid-flight, which would reject this promise unhandled.
    if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, store.clone()).catch(() => {}));
    return store;
  }

  // Upstream errors are passed through but never cached.
  headers.set("X-HKCM-Cache", "SKIP");
  headers.set("X-HKCM-Upstream-Status", String(upstream.status));
  return new Response(upstream.body, { status: upstream.status, headers });
}

// Each of these is a public tile endpoint, which is why handing it to a browser is fine.
// A KEYED url is not.
//
// wrangler.toml documents the upgrade path for when LandsD starts enforcing a key: "the
// keyed URL goes in as a secret with the SAME NAME ... a keyed URL must never be
// committed." That is correct, and this endpoint defeats it: whatever holds
// TILES3D_BUILDING_URL is returned here to anyone who asks, so a secret in that variable
// is a published secret. The two statements cannot both hold.
//
// Refusing beats redacting. A silent rewrite would ship a tileset that does not load with
// no clue why; this 503 names its reason in `wrangler tail` the moment the key arrives,
// which is a bug report instead of an incident. The way to serve a keyed tileset is
// /proxy: data.map.gov.hk is already in the registry, and a secret injected in
// handleProxy never reaches a client.
const KEYED_URL_RE = /[?&](?:key|api[_-]?key|apikey|token|access[_-]?token|signature|sig)=/i;

function handleConfig3d(env) {
  const wgs84 = {
    building: env.TILES3D_BUILDING_URL,
    infrastructure: env.TILES3D_INFRASTRUCTURE_URL,
    tilemodel: env.TILES3D_TILEMODEL_URL,
  };
  if (!wgs84.building || !wgs84.infrastructure || !wgs84.tilemodel) {
    return jsonError(503, "config_missing", "TILES3D_* URLs are not configured server-side");
  }
  const keyed = Object.entries(wgs84).filter(([, u]) => KEYED_URL_RE.test(u));
  if (keyed.length) {
    console.error(`/config/3d refused: keyed URL(s) in ${keyed.map(([k]) => k).join(", ")}`);
    return jsonError(503, "config_keyed",
      "a TILES3D_* URL carries a credential; serve it through /proxy instead");
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

// Exported for worker/test/probe-redirect-policy.mjs, which exercises the redirect rule
// against the REAL redirect chains of the live sources. Testing it by re-implementing the
// rule in the test would only prove the test agrees with itself.
export { fetchValidated, registrableDomain };
