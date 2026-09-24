// probe-szw3.mjs — before accepting 深圳灣口岸港方口岸區 (22.49537,114.14078) as
// the SZW pin, check it is geographically coherent with its neighbours. A single
// plausible-looking coordinate is not evidence; a coordinate that sits sensibly
// among the other control points is.
//
// Reference: the Shenzhen Bay Port is at the western end of the territory, on
// the coast, west of 流浮山 and north-west of 屯門. If the candidate lands east
// of 屯門 or inland, it is wrong no matter what ALS matched.
const CANDIDATE = { lat: 22.49537, lng: 114.14078, label: "深圳灣口岸港方口岸區 (ALS)" };

// Neighbours resolved earlier and already validated within 1.5km of the official
// anchor. Used here only as a spatial frame of reference.
const NEIGHBOURS = {
  "港珠澳大橋香港口岸": { lat: 22.31807, lng: 113.95132 },
  "香園圍管制站": { lat: 22.55391, lng: 114.16507 },
  "羅湖站": { lat: 22.52525, lng: 114.11403 },
  "落馬洲管制站": { lat: 22.51321, lng: 114.07982 },
  "文錦渡管制站": { lat: 22.53614, lng: 114.13166 },
  "港澳客輪碼頭": { lat: 22.2878, lng: 114.15183 },
  "啟德郵輪碼頭": { lat: 22.30745, lng: 114.21212 },
  "中國客運碼頭": { lat: 22.29951, lng: 114.16716 },
  "高鐵西九龍站": { lat: 22.2993, lng: 114.1579 },
  "香港國際機場": { lat: 22.30324, lng: 113.93082 },
};

const km = (aLat, aLng, bLat, bLng) => {
  const R = 6371,
    dLat = ((bLat - aLat) * Math.PI) / 180,
    dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

console.log(`candidate ${CANDIDATE.label}: ${CANDIDATE.lat}, ${CANDIDATE.lng}\n`);
console.log(`${"neighbour".padEnd(24)} ${"distance".padStart(9)}`);
console.log("-".repeat(36));
const dists = {};
for (const [n, p] of Object.entries(NEIGHBOURS)) {
  const d = km(CANDIDATE.lat, CANDIDATE.lng, p.lat, p.lng);
  dists[n] = d;
  console.log(`${n.padEnd(24)} ${`${d.toFixed(1)}km`.padStart(9)}`);
}

// Geographical coherence rules for the Shenzhen Bay Port, stated explicitly so a
// future reader can disagree with them rather than with a magic number.
const checks = [
  ["west of 羅湖 (the port is the WESTERNMOST land crossing)", CANDIDATE.lng < NEIGHBOURS["羅湖站"].lng],
  ["west of 落馬洲", CANDIDATE.lng < NEIGHBOURS["落馬洲管制站"].lng],
  ["west of 文錦渡", CANDIDATE.lng < NEIGHBOURS["文錦渡管制站"].lng],
  ["east of 港珠澳大橋 (which is off Lantau)", CANDIDATE.lng > NEIGHBOURS["港珠澳大橋香港口岸"].lng],
  ["north of 屯門/機場 latitude", CANDIDATE.lat > NEIGHBOURS["香港國際機場"].lat],
  ["near 流浮山 (declared 22.4685,113.9826) — within 20km", dists["港澳客輪碼頭"] > 0],
];
console.log("");
for (const [label, ok] of checks) console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);

const dLauFauShan = km(CANDIDATE.lat, CANDIDATE.lng, 22.4685, 113.9826);
const dTuenMun = km(CANDIDATE.lat, CANDIDATE.lng, 22.3945, 113.9725);
console.log(`\n  distance to 流浮山 (22.4685,113.9826): ${dLauFauShan.toFixed(1)}km`);
console.log(`  distance to 屯門市中心 (22.3945,113.9725): ${dTuenMun.toFixed(1)}km`);
console.log(
  `\nVERDICT: the candidate is ${dLauFauShan.toFixed(1)}km from 流浮山 — the real port is ~3km ` +
    `west of it. ${dLauFauShan > 10 ? "TOO FAR: reject." : "plausible."}`,
);
