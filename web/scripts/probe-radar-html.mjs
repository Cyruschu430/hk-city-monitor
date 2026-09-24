// probe-radar-html.mjs — the failing blob was image/png but contained HTML.
// The radar adapter probes several timestamped URLs and accepts the first 200.
// Test whether the Worker/proxy can return a 200 HTML body for a radar URL.
import { readFileSync } from "node:fs";

const base = "https://hk-city-monitor.cyrus738.workers.dev";

// Reproduce the adapter's candidate generation for the current HKT slot.
function candidates() {
  const hkt = new Date(Date.now() + 8 * 3600_000);
  hkt.setUTCSeconds(0, 0);
  hkt.setUTCMinutes(hkt.getUTCMinutes() - (hkt.getUTCMinutes() % 6));
  const pad = (n) => String(n).padStart(2, "0");
  const out = [];
  for (let i = 0; i < 4; i++) {
    const t = new Date(hkt.getTime() - i * 6 * 60_000);
    const ts = `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}`;
    out.push(`https://www.hko.gov.hk/wxinfo/radars/rad_256_png/2d256nradar_${ts}.jpg`);
  }
  return out;
}

for (const direct of candidates()) {
  const proxied = `${base}/proxy?url=${encodeURIComponent(direct)}`;
  try {
    const r = await fetch(proxied, { signal: AbortSignal.timeout(25000) });
    const buf = Buffer.from(await r.arrayBuffer());
    const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
    const head = buf.slice(0, 60).toString("utf8").replace(/\s+/g, " ");
    console.log(
      `${r.status}  ${isJpg ? "JPEG ✓" : "NOT-JPEG ✗"}  ${buf.length}b  ${direct.slice(-30)}` +
        (isJpg ? "" : `  head="${head}"`),
    );
  } catch (e) {
    console.log(`ERR ${e.message.slice(0, 60)}  ${direct.slice(-30)}`);
  }
}

// And what the satellite adapter would request (the other timestamped source).
console.log("\n--- hko_satellite style path ---");
const sat = `${base}/proxy?url=${encodeURIComponent("https://www.hko.gov.hk/wxinfo/intersat/satellite/image/asia/202609240200+181100GMS-5IR.jpg")}`;
try {
  const r = await fetch(sat, { signal: AbortSignal.timeout(25000) });
  const buf = Buffer.from(await r.arrayBuffer());
  const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
  console.log(`${r.status} ${isJpg ? "JPEG" : "NOT-JPEG"} ${buf.length}b head="${buf.slice(0, 50).toString("utf8").replace(/\s+/g, " ")}"`);
} catch (e) {
  console.log("ERR " + e.message.slice(0, 60));
}
