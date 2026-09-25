// probe-nowcast-frames.mjs — verify the nowcast parser really produces FOUR
// horizons from the live CSV.
//
// The map animation cannot be observed on a dry day: the adapter correctly
// short-circuits to the "no rain" state when every horizon is 0.0mm, so there are
// no frames to animate. That makes the PARSER the thing to test — if it returns
// four grids with distinct endings and real spatial values, the animation has
// something to show the moment it rains, and if it returns one, the feature is
// silently dead and a dry day would hide that forever.
import { parseNowcastFrames } from "../src/lib/parsers.ts";

const url =
  "https://hk-city-monitor.cyrus738.workers.dev/proxy?url=" +
  encodeURIComponent("https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast.csv");

const csv = await (await fetch(url)).text();
console.log(`CSV: ${csv.length} bytes`);

const BBOX = [22.15, 113.83, 22.56, 114.44];
const t0 = Date.now();
const frames = parseNowcastFrames(csv, BBOX);
const ms = Date.now() - t0;

console.log(`parsed ${frames.length} frames in ${ms}ms\n`);
console.log(`${"#".padStart(2)} ${"updated".padEnd(14)} ${"ending".padEnd(14)} grid      max(mm)`);
console.log("-".repeat(58));
for (const [i, g] of frames.entries()) {
  console.log(
    `${String(i).padStart(2)} ${g.updated.padEnd(14)} ${g.ending.padEnd(14)} ` +
      `${String(g.lats.length)}x${String(g.lons.length)}`.padEnd(9) +
      ` ${g.max.toFixed(2)}`,
  );
}

const endings = frames.map((f) => f.ending);
const distinct = new Set(endings).size === endings.length;
console.log(`\ndistinct endings: ${distinct} (${endings.join(", ")})`);
console.log(`assertions:`);
console.log(`  · more than one horizon ......... ${frames.length > 1 ? "PASS" : "FAIL"}`);
console.log(`  · endings are distinct .......... ${distinct ? "PASS" : "FAIL"}`);
console.log(`  · endings ascending (time order)  ${endings.every((e, i) => i === 0 || e > endings[i - 1]) ? "PASS" : "FAIL"}`);
console.log(`  · every frame has a real grid ... ${frames.every((f) => f.lats.length > 5 && f.lons.length > 5) ? "PASS" : "FAIL"}`);

// A frame that is all-zero is fine (a dry day) — but the frames must not all be
// the SAME object, or the animation would visibly not move.
const sig = frames.map((f) => f.vals.flat().reduce((a, b) => a + b, 0));
console.log(`  · frames differ from each other  ${new Set(sig.map((s) => s.toFixed(3))).size > 1 ? "PASS (they differ)" : "SAME (dry — nothing to animate today)"}`);
