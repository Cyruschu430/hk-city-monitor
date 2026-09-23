// probe-adsb-collector-viable.mjs — can a PC-side collector feed the aircraft
// layer? Both providers block Cloudflare's egress, but both answered 200 from
// this machine. If a local collector can fetch reliably, the layer comes back
// without needing a key or a paid tier.
//
// This measures RELIABILITY, not one lucky call: 10 sequential fetches per
// provider, spaced, reporting the status distribution and the payload shape.
const providers = [
  ["adsb.fi", "https://opendata.adsb.fi/api/v2/lat/22.32/lon/114.17/dist/100"],
  ["adsb.lol", "https://api.adsb.lol/v2/point/22.32/114.17/100"],
];

for (const [name, url] of providers) {
  const codes = [];
  let lastCount = null;
  let sampleKeys = null;
  for (let i = 0; i < 10; i++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": "hk-city-monitor/0.4 (+https://github.com/Cyruschu430/hk-city-monitor)" },
        signal: AbortSignal.timeout(20000),
      });
      codes.push(r.status);
      if (r.status === 200) {
        const j = await r.json();
        const list = j.ac ?? j.aircraft ?? [];
        lastCount = list.length;
        if (!sampleKeys && list[0]) sampleKeys = Object.keys(list[0]).slice(0, 8);
      }
    } catch (e) {
      codes.push("ERR:" + e.name);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  const tally = codes.reduce((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {});
  console.log(`${name.padEnd(9)} ${JSON.stringify(tally)}  aircraft(last 200)=${lastCount}`);
  if (sampleKeys) console.log(`          keys: ${sampleKeys.join(",")}`);
}
