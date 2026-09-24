// probe-szw2.mjs — 深圳灣 (SZW) is the one ImD control point ALS cannot resolve
// by name (every variant lands ~30.6km away, a district-level fallback).
//
// A hand-rolled HK1980 -> WGS84 conversion was tried first and was WRONG by a
// constant ~503km in latitude, so it is abandoned rather than debugged: a subtly
// wrong projection is exactly how a confident pin ends up in the wrong place.
//
// Instead, ask ALS about ADDRESSES that are known to be AT the port itself. ALS
// is the authority here and it already proved it resolves building-level
// addresses well. The port sits on the Hong Kong side of the Shenzhen Bay Bridge.
const WORKER = "https://hk-city-monitor.cyrus738.workers.dev";
const target = (u) => `${WORKER}/proxy?url=${encodeURIComponent(u)}`;

const QUERIES = [
  "深圳灣口岸港方口岸區",
  "深圳灣口岸",
  "深圳灣管制站",
  "新深路",
  "深港西部通道",
  "深圳灣公路大橋",
  "港深西部公路",
  "鰲磡石",
  "流浮山",
  "廈村",
];

async function als(q) {
  const res = await fetch(target(`https://www.als.gov.hk/lookup?q=${encodeURIComponent(q)}`));
  if (!res.ok) return null;
  const xml = await res.text();
  const first = xml.split("<SuggestedAddress>")[1];
  if (!first) return null;
  const lat = /<Latitude>([^<]+)<\/Latitude>/.exec(first)?.[1];
  const lng = /<Longitude>([^<]+)<\/Longitude>/.exec(first)?.[1];
  // Pull the matched street/estate so we can see WHAT it actually matched.
  const street = /<StreetName>([^<]*)<\/StreetName>/.exec(first)?.[1] ?? "";
  const estate = /<EstateName>([^<]*)<\/EstateName>/.exec(first)?.[1] ?? "";
  const dist = /<DcDistrict>([^<]*)<\/DcDistrict>/.exec(first)?.[1] ?? "";
  if (!lat || !lng) return null;
  return { lat: Number(lat), lng: Number(lng), street, estate, dist, n: (xml.match(/<SuggestedAddress>/g) ?? []).length };
}

// The port area is around 22.50-22.52 N, 113.94-113.96 E. Anything outside that
// box is a fallback match, not the port.
const inBox = (lat, lng) => lat > 22.47 && lat < 22.56 && lng > 113.90 && lng < 114.02;

for (const q of QUERIES) {
  const h = await als(q);
  if (!h) {
    console.log(`  ${q.padEnd(18)} MISS`);
  } else {
    const box = inBox(h.lat, h.lng) ? "IN-PORT-BOX" : "outside";
    console.log(
      `  ${q.padEnd(18)} ${`${h.lat.toFixed(5)},${h.lng.toFixed(5)}`.padEnd(22)} n=${String(h.n).padStart(3)} ${box.padEnd(13)} ${h.dist} | ${h.estate || h.street}`,
    );
  }
  await new Promise((r) => setTimeout(r, 350));
}
