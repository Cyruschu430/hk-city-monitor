// probe-adsb-production.mjs — adsb.fi returns 403 to Cloudflare's egress IPs.
// Establish whether the FALLBACK (adsb.lol) works in production, because if both
// are blocked the aircraft layer cannot work once deployed.
const BASE = "https://hk-city-monitor.cyrus738.workers.dev";

const targets = [
  ["adsb.fi (primary)", "https://opendata.adsb.fi/api/v2/lat/22.32/lon/114.17/dist/50"],
  ["adsb.lol (fallback)", "https://api.adsb.lol/v2/point/22.32/114.17/100"],
];

for (const [label, url] of targets) {
  const proxied = `${BASE}/proxy?url=${encodeURIComponent(url)}`;
  try {
    const r = await fetch(proxied, { signal: AbortSignal.timeout(30000) });
    const upstream = r.headers.get("x-hkcm-upstream-status") ?? "-";
    const cache = r.headers.get("x-hkcm-cache") ?? "-";
    const text = await r.text();
    let count = "?";
    try {
      const j = JSON.parse(text);
      count = (j.ac ?? j.aircraft ?? []).length;
    } catch { /* not json */ }
    console.log(`${label}: HTTP ${r.status}  upstream=${upstream}  cache=${cache}  aircraft=${count}  bytes=${text.length}`);
  } catch (e) {
    console.log(`${label}: FETCH ERROR ${e.message}`);
  }
}

// Direct (unproxied) for comparison — is adsb.lol reachable from this machine?
try {
  const r = await fetch("https://api.adsb.lol/v2/point/22.32/114.17/100", { signal: AbortSignal.timeout(20000) });
  const t = await r.text();
  let n = "?";
  try { n = (JSON.parse(t).ac ?? []).length; } catch {}
  console.log(`\nadsb.lol direct from this PC: HTTP ${r.status}  aircraft=${n}`);
} catch (e) {
  console.log(`\nadsb.lol direct: ERROR ${e.message}`);
}
