#!/usr/bin/env node
// probe-fixtures.mjs — captures REAL source payloads into web/test/fixtures/
// so parser tests run against what the sources actually send, offline.
// Re-run any time; it overwrites. Nothing here ships in the bundle.
//
// WSD needs TLS SECLEVEL=1 (Pitfall 9: older HK gov TLS stacks only negotiate
// there; the failure looks like a dead source and is our own client).

import { writeFileSync, mkdirSync } from "node:fs";
import { get } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures");
mkdirSync(out, { recursive: true });

const UA = "hk-city-monitor/0.2 (+https://github.com/Cyruschu430/hk-city-monitor)";

async function fetchBytes(url, { ciphers } = {}) {
  if (!ciphers) {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
  }
  return new Promise((resolve, reject) => {
    const req = get(url, { headers: { "User-Agent": UA }, ciphers, timeout: 15_000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, bytes: Buffer.concat(chunks) }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

const probes = [
  ["warnsum.json", "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc"],
  ["warninginfo.json", "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warningInfo&lang=tc"],
  ["specialtrafficnews.xml", "https://resource.data.one.gov.hk/td/tc/specialtrafficnews.xml"],
  ["wsd_water_suspension.csv", "https://www.esd.wsd.gov.hk/wsms_open_data/WSMS_OPEN_DATA(all).csv", { ciphers: "DEFAULT@SECLEVEL=1" }],
  ["immd_cp_queue.json", "https://secure1.info.gov.hk/immd/mobileapps/2bb9ae17/data/CPQueueTimeR.json"],
  ["ferry_arrival_tc.csv", "https://www.mardep.gov.hk/e_files/hk/opendata/arrival_tc.csv"],
  ["hkia_flights.json", `https://www.hongkongairport.com/flightinfo-rest/rest/flights?date=${new Date().toISOString().slice(0, 10)}&lang=en&arrival=true&cargo=false`, { structural: "hkia" }],
  ["ae_waiting.json", "https://www.ha.org.hk/opendata/aed/aedwtdata2-tc.json"],
  ["rain_nowcast.csv", "https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast.csv", { structural: "nowcast" }],
  ["tc_list.xml", "https://www.weather.gov.hk/wxinfo/currwx/tc_list.xml"],
  ["rhrread.json", "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc"],
];

for (const [name, url, opts = {}] of probes) {
  try {
    const { status, bytes } = await fetchBytes(url, opts);
    let data = opts.trim ? bytes.subarray(0, opts.trim) : bytes;
    if (opts.structural === "nowcast") {
      // The full file is ~2.7 MB over several forecast horizons; keep the
      // header plus the first horizon's rows inside the HK bbox (+pad), so
      // the fixture is small but parses exactly like the real thing.
      const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
      const kept = [lines[0]];
      let ending = null;
      for (const l of lines.slice(1)) {
        const c = l.split(",");
        if (c.length < 5) continue;
        if (!ending) ending = c[1];
        else if (c[1] !== ending) break;
        const lat = Number(c[2]), lon = Number(c[3]);
        if (lat >= 22.09 && lat <= 22.62 && lon >= 113.77 && lon <= 114.5) kept.push(l);
      }
      data = Buffer.from(kept.join("\n"));
    }
    if (opts.structural === "hkia") {
      // Full payload is ~200 KB and fine at runtime through the edge cache;
      // the fixture keeps the first 12 rows per day so tests stay small but
      // parse the exact same structure.
      const j = JSON.parse(new TextDecoder().decode(bytes));
      const slim = j.slice(0, 2).map((d) => ({ ...d, list: (d.list ?? []).slice(0, 12) }));
      data = Buffer.from(JSON.stringify(slim));
    }
    writeFileSync(join(out, name), data);
    const head = new TextDecoder("utf-8", { fatal: false }).decode(data.subarray(0, 120)).replace(/\s+/g, " ").trim();
    console.log(`✓ ${name}  HTTP ${status}  ${bytes.length}B${opts.trim ? ` (trimmed to ${data.length})` : ""}\n    ${head}`);
  } catch (err) {
    console.log(`✗ ${name}  FAILED: ${err.message}`);
  }
}
console.log("\nfixtures written to web/test/fixtures/");
