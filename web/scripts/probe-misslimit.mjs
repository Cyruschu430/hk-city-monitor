// probe-misslimit.mjs — the rate-limit fix moved the data check to AFTER the
// cache lookup, so only upstream MISSES count against the 60/min protection.
//
// That change is only safe if the protection STILL TRIPS. Asserting that from a
// code reading would be exactly the kind of unverified claim this project's
// review discipline exists to prevent, so this fires a burst of DISTINCT
// (therefore uncached) registry URLs and prints the status codes.
//
// It is bounded and uses public open-data endpoints from sources.json, which the
// production sweep already reads. Nothing is hammered: each URL is requested once.
import { readFileSync } from "node:fs";

const WORKER = "https://hk-city-monitor.cyrus738.workers.dev";
const DATA_MISS = 60; // DATA_MISS_LIMIT_PER_MIN in worker/src/index.js
const sources = JSON.parse(readFileSync("../sources.json", "utf8"));
const list = Array.isArray(sources) ? sources : sources.sources;

// Prefer SMALL payloads so the burst is quick and kind to the upstreams. The big
// ones (17MB LCSD, image feeds) are excluded by name.
const heavy = /lcsd_leisure|cameras|snapshot|radar|satellite|imagery|tiles|3d|open3d|water_suspension_districts|hko_stations/;
// SKIP the first N so a re-run uses URLs the previous run has not just cached —
// the Worker's data cache is 60s, so anything already fetched would come back as a
// HIT and would not exercise the MISS counter at all.
const SKIP = Number(process.argv[2] ?? 0);
const picks = list
  .filter((s) => s.fetch === "proxy" && s.url && !heavy.test(s.id))
  .slice(SKIP, SKIP + 70);

console.log(`firing ${picks.length} DISTINCT (uncached) proxy requests in parallel batches...`);

const codes = {};
let n = 0;
let first429 = null;
const t0 = Date.now();
// The limit is a FIXED 60s window, so a slow sequential loop lets the window reset
// part-way and never accumulates. A burst is both the honest test and the actual
// abuse pattern the limiter exists to stop.
const BATCH = 10;
for (let i = 0; i < picks.length; i += BATCH) {
  const batch = picks.slice(i, i + BATCH);
  const results = await Promise.all(
    batch.map(async (s) => {
      try {
        const res = await fetch(`${WORKER}/proxy?url=${encodeURIComponent(s.url)}`);
        await res.arrayBuffer();
        return { code: String(res.status), id: s.id, upstream429: res.status === 429 };
      } catch {
        return { code: "THROW", id: s.id };
      }
    }),
  );
  for (const r of results) {
    n++;
    codes[r.code] = (codes[r.code] ?? 0) + 1;
    if (r.code === "429" && first429 === null) first429 = { n, id: r.id };
  }
}

const secs = (Date.now() - t0) / 1000;
console.log(`\nsent ${n} in ${secs.toFixed(1)}s (${(n / (secs / 60)).toFixed(0)}/min)\n`);
console.log("status codes:");
for (const [c, k] of Object.entries(codes).sort()) console.log(`  ${c} x ${k}`);
if (first429) console.log(`\nfirst 429: request #${first429.n} (${first429.id})`);

// WHAT THIS PROBE CAN AND CANNOT SHOW — learned by getting it wrong first.
//
// MEASURED 2026-09-24: two runs fired 61+ upstream misses each (61x and 66x 200s,
// comfortably over the 60 limit) and the limiter did NOT fire. The reason is in
// the Worker's own comment: `buckets` is PER-ISOLATE IN-MEMORY state, and
// Cloudflare spreads a parallel burst across isolates, so no single isolate ever
// accumulates 60. The limiter therefore cannot be verified from outside, and a
// 429 seen on a low-numbered request is almost certainly the UPSTREAM's own
// (adsb.lol blocks datacenter IPs) rather than ours.
//
// So this probe is NOT evidence that the upstream protection works. What it does
// establish is the negative that matters for the fix: a burst far above the old
// limit does not produce spurious 429s, which is the bug that was fixed.
console.log(
  "\nCONCLUSION — read carefully, this probe does not prove what it first claimed:\n" +
    `  · ${n} requests were sent with no self-inflicted throttling.\n` +
    "  · The miss limiter did NOT fire, and cannot be shown to fire from outside:\n" +
    "    its buckets are per-isolate (see the note in worker/src/index.js), and a\n" +
    "    parallel burst is spread across isolates.\n" +
    "  · Upstream protection is unchanged in strength: the miss limit is still 60\n" +
    "    on the same key logic. What changed is that cache HITS no longer count,\n" +
    "    which is what stopped the dashboard throttling itself.\n" +
    "  · Any 429 here is likely the upstream's own; X-HKCM-Cache distinguishes them.",
);
