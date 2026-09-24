// probe-controlpoints.mjs — resolve the ImD control points to coordinates and
// CHECK them against ground truth before any of it reaches the app.
//
// Why this exists: a first ALS pass on the station names returned IDENTICAL
// coordinates for pairs that are 25km apart (落馬洲 vs 落馬洲支線; 羅湖 vs
// 沙頭角). ALS had silently fallen back to a district-level suggestion, and
// accepting it would have put pins in the wrong place — the exact failure the
// water-geocoding work was careful to avoid. This script prints the candidate
// names AND a sanity distance from a known-good reference so a bad hit is
// obvious rather than plausible.
const WORKER = "https://hk-city-monitor.cyrus738.workers.dev";

// Ground truth for sanity checking, from the official ImD control-point list
// (immd.gov.hk/hkt/contactus/control_points.html) cross-read with map.gov.hk.
// These are APPROXIMATE anchors used ONLY to reject a wrong lookup — they are
// never shipped as the pin position.
const ANCHORS = {
  HYW: { name: "香港國際機場", lat: 22.3080, lng: 113.9185 },
  SKW: { name: "羅湖", lat: 22.5320, lng: 114.1130 },
  LMC: { name: "落馬洲", lat: 22.5150, lng: 114.0720 },
  LMB: { name: "落馬洲支線", lat: 22.5140, lng: 114.0680 },
  MKT: { name: "文錦渡", lat: 22.5370, lng: 114.1180 },
  STK: { name: "沙頭角", lat: 22.5480, lng: 114.2110 },
  CCP: { name: "中國客運碼頭", lat: 22.2990, lng: 114.1680 },
  MFP: { name: "港澳客輪碼頭", lat: 22.2880, lng: 114.1520 },
  SZW: { name: "深圳灣", lat: 22.5030, lng: 113.9450 },
  KKT: { name: "啟德郵輪碼頭", lat: 22.3070, lng: 114.2130 },
  XRL: { name: "高鐵西九龍", lat: 22.3040, lng: 114.1660 },
  HZM: { name: "港珠澳大橋香港口岸", lat: 22.3160, lng: 113.9450 },
  HY2: { name: "香園圍", lat: 22.5540, lng: 114.1660 },
};

// Candidate query strings per code — several, because ALS matches one place name
// and the official designations differ from what the map labels say.
const QUERIES = {
  HYW: ["香港國際機場一號客運大樓", "香港國際機場"],
  SKW: ["羅湖站", "羅湖管制站", "羅湖"],
  LMC: ["落馬洲管制站", "落馬洲"],
  LMB: ["落馬洲站", "落馬洲支線管制站"],
  MKT: ["文錦渡管制站", "文錦渡"],
  STK: ["沙頭角管制站", "沙頭角"],
  CCP: ["中國客運碼頭", "中港城"],
  MFP: ["港澳客輪碼頭", "港澳碼頭"],
  SZW: ["深圳灣管制站", "深圳灣口岸", "深圳灣公路大橋"],
  KKT: ["啟德郵輪碼頭"],
  XRL: ["高鐵西九龍站", "香港西九龍站"],
  HZM: ["港珠澳大橋香港口岸", "港珠澳大橋"],
  HY2: ["香園圍管制站", "香園圍口岸", "蓮塘/香園圍口岸"],
};

const haversineKm = (aLat, aLng, bLat, bLng) => {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

async function lookup(q) {
  const target = `https://www.als.gov.hk/lookup?q=${encodeURIComponent(q)}`;
  const url = `${WORKER}/proxy?url=${encodeURIComponent(target)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const xml = await res.text();
  const first = xml.split("<SuggestedAddress>")[1];
  if (!first) return null;
  const lat = /<Latitude>([^<]+)<\/Latitude>/.exec(first)?.[1];
  const lng = /<Longitude>([^<]+)<\/Longitude>/.exec(first)?.[1];
  if (!lat || !lng) return null;
  // How many suggestions came back tells us how confident the match is.
  const n = (xml.match(/<SuggestedAddress>/g) ?? []).length;
  return { lat: Number(lat), lng: Number(lng), suggestions: n };
}

console.log(`${"code".padEnd(5)} ${"query".padEnd(26)} ${"lat,lng".padEnd(22)} sug  dist  verdict`);
console.log("-".repeat(94));
const chosen = {};
for (const [code, queries] of Object.entries(QUERIES)) {
  const anchor = ANCHORS[code];
  for (const q of queries) {
    const hit = await lookup(q);
    if (!hit) {
      console.log(`${code.padEnd(5)} ${q.padEnd(26)} ${"MISS".padEnd(22)}`);
      continue;
    }
    const dist = haversineKm(hit.lat, hit.lng, anchor.lat, anchor.lng);
    const ok = dist <= 1.5;
    console.log(
      `${code.padEnd(5)} ${q.padEnd(26)} ${`${hit.lat.toFixed(5)},${hit.lng.toFixed(5)}`.padEnd(22)} ` +
        `${String(hit.suggestions).padStart(3)} ${dist.toFixed(2).padStart(5)}  ${ok ? "OK" : "REJECT"}`,
    );
    if (ok && !chosen[code]) chosen[code] = { q, ...hit, distKm: dist };
    await new Promise((r) => setTimeout(r, 300));
  }
}

console.log("\n=== accepted (within 1.5km of the official anchor) ===");
for (const [code, v] of Object.entries(chosen)) {
  console.log(`  ${code.padEnd(5)} ${v.q.padEnd(26)} ${v.lat.toFixed(5)},${v.lng.toFixed(5)}  (${v.distKm.toFixed(2)}km)`);
}
const missing = Object.keys(QUERIES).filter((c) => !chosen[c]);
console.log(missing.length ? `\nUNRESOLVED: ${missing.join(", ")}` : "\nall 13 resolved");
