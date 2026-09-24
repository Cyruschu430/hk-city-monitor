// probe-szw.mjs — 深圳灣 (SZW) is the one control point ALS cannot resolve:
// every name variant lands ~30.6km away, i.e. ALS fell back to a district-level
// suggestion. Do NOT accept that. Try the other registered geocoding source
// (map.gov.hk locationSearch) and the official GeoInfo Map IDs from the ImD
// control-point page before falling back to "district-level only" for this one.
const WORKER = "https://hk-city-monitor.cyrus738.workers.dev";
const target = (u) => `${WORKER}/proxy?url=${encodeURIComponent(u)}`;

async function get(u) {
  const res = await fetch(target(u));
  return res.ok ? await res.text() : `HTTP ${res.status}`;
}

console.log("=== map.gov.hk locationSearch (registered source) ===");
for (const q of ["深圳灣管制站", "深圳灣口岸", "深圳灣", "深圳灣大橋"]) {
  const body = await get(`https://www.map.gov.hk/gs/api/v1.0.0/locationSearch?q=${encodeURIComponent(q)}`);
  let out = body.slice(0, 200).replace(/\s+/g, " ");
  try {
    const j = JSON.parse(body);
    const first = Array.isArray(j) ? j[0] : j;
    const lat = first?.y ?? first?.lat ?? first?.latitude;
    const lng = first?.x ?? first?.lng ?? first?.longitude;
    out = lat ? `HIT ${lat},${lng}  name=${first?.name ?? "?"}` : `shape=${Object.keys(first ?? {}).join(",")}`;
  } catch {
    /* not JSON — show the raw head */
  }
  console.log(`  ${q.padEnd(14)} ${out}`);
  await new Promise((r) => setTimeout(r, 400));
}

console.log("\n=== official GeoInfo Map feature ids from the ImD control-point page ===");
// The ImD page links each control point to map.gov.hk/gm/s/F/<id>. Try to turn
// one into coordinates through the map viewer's own API rather than scraping.
for (const [label, id] of [["深圳灣", "90016424"], ["羅湖", "90016346"], ["沙頭角", "90016342"]]) {
  const r = await fetch(`https://www.map.gov.hk/gm/s/F/${id}`, { redirect: "follow" });
  console.log(`  ${label.padEnd(8)} id=${id}  final=${r.status} ${r.url}`);
}
