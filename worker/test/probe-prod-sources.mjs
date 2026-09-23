// probe-prod-sources.mjs — sweep EVERY proxy source through the DEPLOYED Worker
// and report which ones actually work in production. Local dev succeeding says
// nothing about production: the egress IP is different, and that is exactly what
// broke the ADS-B feeds.
import { readFileSync } from "node:fs";

const BASE = "https://hk-city-monitor.cyrus738.workers.dev";
const src = JSON.parse(readFileSync("C:/hk-city-monitor/sources.json", "utf8"));
const proxySources = src.sources.filter((s) => s.fetch === "proxy");

console.log(`Sweeping ${proxySources.length} proxy sources through the deployed Worker...\n`);

const results = [];
const CONCURRENCY = 6;
let i = 0;
async function worker() {
  while (i < proxySources.length) {
    const s = proxySources[i++];
    const url = `${BASE}/proxy?url=${encodeURIComponent(s.url)}`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
      const upstream = r.headers.get("x-hkcm-upstream-status");
      results.push({ id: s.id, status: r.status, upstream, blocked: r.status === 403 || r.status === 429 });
    } catch (e) {
      results.push({ id: s.id, status: "ERR", upstream: null, err: String(e.message).slice(0, 40), blocked: false });
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const ok = results.filter((r) => r.status === 200);
const refused = results.filter((r) => r.status === 403);
const limited = results.filter((r) => r.status === 429);
const other = results.filter((r) => !ok.includes(r) && !refused.includes(r) && !limited.includes(r));

console.log(`OK       200 : ${ok.length}`);
console.log(`BLOCKED  403 : ${refused.length}   <- upstream refuses Cloudflare egress`);
console.log(`RATELIM  429 : ${limited.length}`);
console.log(`OTHER        : ${other.length}`);

if (refused.length) {
  console.log("\n403 (upstream blocks datacenter IPs):");
  for (const r of refused.slice(0, 25)) console.log("  " + r.id);
}
if (limited.length) {
  console.log("\n429 (rate limited at the edge):");
  for (const r of limited.slice(0, 15)) console.log("  " + r.id);
}
if (other.length) {
  console.log("\nOTHER:");
  for (const r of other.slice(0, 20)) console.log(`  ${r.id}  status=${r.status} upstream=${r.upstream ?? "-"} ${r.err ?? ""}`);
}
