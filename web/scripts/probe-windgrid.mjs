// probe-windgrid.mjs — can Open-Meteo serve a dense enough U/V grid for a
// particle wind animation over Hong Kong, in ONE request?
//
// Open-Meteo is already in sources.json (id `open_meteo`, fetch: browser, keyless,
// CC BY 4.0), so no new host has to be whitelisted. It returns an ARRAY when given
// comma-separated latitudes/longitudes, and each element carries
// hourly.wind_u_component_10m / wind_v_component_10m — a genuine vector field,
// unlike HKO's station points which are only ~30 samples.
//
// What matters for feasibility: URL length, response size, latency, and whether
// the API actually honours a large multi-point request rather than truncating it.
const CANDIDATES = [
  { name: "8x6  (48pts)", nx: 8, ny: 6 },
  { name: "11x9 (99pts)", nx: 11, ny: 9 },
  { name: "16x12(192pts)", nx: 16, ny: 12 },
  { name: "22x16(352pts)", nx: 22, ny: 16 },
];

// Hong Kong bounding box, slightly padded so particles do not die at the edge.
const LAT0 = 22.13, LAT1 = 22.60, LON0 = 113.80, LON1 = 114.48;

for (const c of CANDIDATES) {
  const lats = [];
  const lons = [];
  for (let y = 0; y < c.ny; y++) {
    for (let x = 0; x < c.nx; x++) {
      lats.push((LAT0 + ((LAT1 - LAT0) * y) / (c.ny - 1)).toFixed(4));
      lons.push((LON0 + ((LON1 - LON0) * x) / (c.nx - 1)).toFixed(4));
    }
  }
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats.join(",")}&longitude=${lons.join(",")}` +
    `&current=wind_speed_10m,wind_direction_10m&hourly=wind_u_component_10m,wind_v_component_10m` +
    `&forecast_days=1&timezone=Asia%2FHong_Kong`;

  const t0 = Date.now();
  let status = "ERR", bytes = 0, count = 0, sample = null;
  try {
    const res = await fetch(url);
    status = String(res.status);
    const text = await res.text();
    bytes = text.length;
    const j = JSON.parse(text);
    const arr = Array.isArray(j) ? j : [j];
    count = arr.length;
    const first = arr[0];
    if (first?.hourly?.wind_u_component_10m) {
      sample = { u: first.hourly.wind_u_component_10m[0], v: first.hourly.wind_v_component_10m[0] };
    }
  } catch (e) {
    status = "THROW " + e.message.slice(0, 40);
  }
  const ms = Date.now() - t0;
  console.log(
    `${c.name.padEnd(14)} HTTP ${status.padEnd(4)} url=${String(url.length).padStart(5)}ch ` +
      `got=${String(count).padStart(4)} bytes=${String(bytes).padStart(7)} ${String(ms).padStart(5)}ms ` +
      `${sample ? `u=${sample.u} v=${sample.v}` : ""}`,
  );
  await new Promise((r) => setTimeout(r, 600));
}
