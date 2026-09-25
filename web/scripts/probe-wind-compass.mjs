// probe-wind-compass.mjs — parse the LIVE wind CSV with the REAL parser and
// report how many stations keep a bearing.
//
// The bug this exists for: `COMPASS` had full words for North/East/South/West and
// ABBREVIATIONS for the other twelve points, while the CSV publishes full words
// throughout. Only East and South matched, so most stations lost `dirDeg`, and
// `joinWindToStations` DROPS a station with no bearing — the barb map drew a
// fraction of the network and the panel's mean was computed over a subset.
//
// It matters that this runs against the live file rather than the fixture: the
// fixture is a 28-row capture, and a fixture captured on a day when the wind
// happened to blow from the two surviving directions would have hidden this
// entirely (Pitfall 18's shape).
import { parseWindCsv, windStatus } from "../src/lib/parsers.ts";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const url = "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_wind.csv";
const csv = await (await fetch(url, { headers: { "User-Agent": UA } })).text();

const { stations, observedAt } = parseWindCsv(csv);
const withBearing = stations.filter((s) => s.dirDeg !== null);
const lost = stations.filter((s) => s.dirDeg === null && !["N/A", "Calm", "Variable", ""].includes(s.dirText));

console.log(`file          : ${csv.length} B, observed ${observedAt?.toISOString() ?? "?"}`);
console.log(`stations      : ${stations.length}`);
console.log(`with a bearing: ${withBearing.length}`);
console.log(`non-answers   : ${stations.filter((s) => s.dirDeg === null).map((s) => s.dirText).join(", ") || "(none)"}`);
console.log(`LOST bearings : ${lost.length}${lost.length ? " -> " + lost.map((s) => `${s.name}=${s.dirText}`).join(", ") : ""}`);
console.log(`distinct dirs : ${JSON.stringify([...new Set(stations.map((s) => s.dirText))])}`);
console.log("cells         :");
for (const c of windStatus(stations)) console.log(`   ${c.label}: ${c.value}`);
// The number that changed. `mean` is computed over stations that HAVE a bearing,
// so losing bearings both shrank the sample and biased the mean.
const speeds = withBearing.map((s) => s.speedKmh ?? 0).filter((v) => v > 0);
console.log(`mean over bearing-holders: ${(speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1)} km/h (n=${speeds.length})`);
