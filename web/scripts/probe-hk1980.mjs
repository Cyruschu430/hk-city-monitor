// probe-hk1980.mjs — convert the HK1980 Grid coordinates that map.gov.hk's
// locationSearch returns into WGS84 lat/lng, and validate the conversion against
// control points whose position we already know to be correct.
//
// The projection is the Hong Kong 1980 Geodetic Datum, HK1980 Grid (EPSG:2326).
// Rather than hand-roll a Transverse Mercator, this checks the result against
// points that ALS already resolved correctly (香園圍 22.55391,114.16507 etc.):
// if the conversion reproduces those from their grid coordinates, it is sound.
//
// Why bother: 深圳灣 is the ONE control point ALS could not resolve (every name
// variant landed ~30.6km away). locationSearch DOES find it, in grid metres.
const WORKER = "https://hk-city-monitor.cyrus738.workers.dev";

// EPSG:2326 <-> WGS84. Parameters for the HK1980 Grid Transverse Mercator on the
// HK1980 datum, plus the datum shift to WGS84. Constants from the HK Lands
// Department geodetic documentation.
const A = 6378388.0; // HK1980 semi-major (International 1924)
const F = 1 / 297.0; // International 1924 flattening
const LAT0 = (22 + 18 / 60 + 43.68 / 3600) * (Math.PI / 180);
const LON0 = (114 + 10 / 60 + 42.8 / 3600) * (Math.PI / 180);
const N0 = 819069.8;
const E0 = 836694.05;
const K0 = 1;

function gridToLatLng(easting, northing) {
  const e2 = 2 * F - F * F;
  const e = Math.sqrt(e2);
  const M0 =
    A *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * LAT0 -
      ((3 * e) / 2 - (3 * e ** 3) / 32 - (45 * e ** 5) / 1024) * Math.sin(2 * LAT0) +
      ((15 * e2) / 16 - (45 * e ** 4) / 1024) * Math.sin(4 * LAT0) -
      ((35 * e ** 3) / 48) * Math.sin(6 * LAT0));
  const M = M0 + (northing - N0) / K0;

  const mu = M / (A * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sinPhi = Math.sin(phi1);
  const cosPhi = Math.cos(phi1);
  const tanPhi = Math.tan(phi1);
  const nu = A / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const rho = (A * (1 - e2)) / (1 - e2 * sinPhi * sinPhi) ** 1.5;
  const psi = nu / rho;
  const t = tanPhi * tanPhi;
  const D = (easting - E0) / (nu * K0);

  const lat =
    phi1 -
    ((nu * tanPhi) / rho) *
      (D ** 2 / 2 -
        ((5 + 3 * t + 10 * psi - 4 * psi * psi - 9 * (e2 / (1 - e2))) * D ** 4) / 24 +
        ((61 + 90 * t + 298 * psi + 45 * t * t - 252 * (e2 / (1 - e2)) - 3 * psi * psi) * D ** 6) / 720);
  const lng =
    LON0 +
    (D -
      ((1 + 2 * t + psi) * D ** 3) / 6 +
      ((5 - 2 * psi + 28 * t - 3 * psi * psi + 8 * (e2 / (1 - e2)) + 24 * t * t) * D ** 5) / 120) /
      cosPhi;

  // HK1980 -> WGS84 datum shift (small but not zero; ~200m if omitted).
  const latD = (lat * 180) / Math.PI - 0.002135;
  const lngD = (lng * 180) / Math.PI + 0.003155;
  return { lat: latD, lng: lngD };
}

// Validation set: control points whose WGS84 position ALS resolved correctly
// (all within 1.5km of the official anchor). Their HK1980 grid coordinates come
// from map.gov.hk locationSearch.
const VALIDATE = [
  { name: "香園圍管制站", wgs: [22.55391, 114.16507], query: "香園圍管制站" },
  { name: "港澳客輪碼頭", wgs: [22.2878, 114.15183], query: "港澳客輪碼頭" },
  { name: "啟德郵輪碼頭", wgs: [22.30745, 114.21212], query: "啟德郵輪碼頭" },
  { name: "港珠澳大橋香港口岸", wgs: [22.31807, 113.95132], query: "港珠澳大橋香港口岸" },
  { name: "深圳灣口岸", wgs: null, query: "深圳灣口岸" },
];

const target = (u) => `${WORKER}/proxy?url=${encodeURIComponent(u)}`;
const km = (aLat, aLng, bLat, bLng) => {
  const R = 6371,
    dLat = ((bLat - aLat) * Math.PI) / 180,
    dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

console.log(`${"place".padEnd(22)} ${"grid E,N".padEnd(26)} ${"-> wgs84".padEnd(22)} vs ALS`);
console.log("-".repeat(84));
for (const v of VALIDATE) {
  const res = await fetch(target(`https://www.map.gov.hk/gs/api/v1.0.0/locationSearch?q=${encodeURIComponent(v.query)}`));
  if (!res.ok) {
    console.log(`${v.name.padEnd(22)} locationSearch HTTP ${res.status}`);
    continue;
  }
  const j = await res.json();
  const first = Array.isArray(j) ? j[0] : j;
  const E = Number(first?.x),
    N = Number(first?.y);
  if (!Number.isFinite(E) || !Number.isFinite(N)) {
    console.log(`${v.name.padEnd(22)} no x/y in ${JSON.stringify(first).slice(0, 60)}`);
    continue;
  }
  const { lat, lng } = gridToLatLng(E, N);
  const cmp = v.wgs ? `${km(lat, lng, v.wgs[0], v.wgs[1]).toFixed(2)}km` : "(the target)";
  console.log(
    `${v.name.padEnd(22)} ${`${E.toFixed(0)},${N.toFixed(0)}`.padEnd(26)} ${`${lat.toFixed(5)},${lng.toFixed(5)}`.padEnd(22)} ${cmp}`,
  );
  await new Promise((r) => setTimeout(r, 400));
}
