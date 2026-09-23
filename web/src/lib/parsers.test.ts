// parsers.test.ts — every parser runs OFFLINE against real captured payloads
// (web/test/fixtures/, refreshed by scripts/probe-fixtures.mjs). A parser that
// only works on the day it was written is how dashboards lie; fixtures keep
// the shapes honest.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

(globalThis as Record<string, unknown>)["localStorage"] = {
  getItem: () => null,
  setItem: () => {},
};

const P = await import("./parsers.ts");
const fx = (name: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "fixtures", name));
const jx = (name: string) => JSON.parse(fx(name).toString("utf8").replace(/^\uFEFF/, ""));

// 1. warnsum — live capture had 酷熱天氣警告 + 火災危險警告 in force.
{
  const { items, observedAt } = P.parseWarnsum(JSON.parse(fx("warnsum.json").toString("utf8")));
  assert.equal(items.length, 2);
  assert.ok(items.some((i) => i.title.includes("酷熱天氣警告")), "酷熱警告 parsed");
  assert.equal(observedAt?.toISOString(), "2026-09-19T05:00:00.000Z", "updateTime 13:00+08:00 → 05:00Z");
  console.log("✓ warnsum: 2 個生效警告（酷熱、火災黃色）observedAt", observedAt?.toISOString());
}

// 2. special traffic news XML.
{
  const { items, observedAt } = P.parseSpecialTraffic(fx("specialtrafficnews.xml").toString("utf8"));
  assert.ok(items.length > 0, "traffic items exist");
  assert.ok(items[0]!.title.length > 10, "has real text");
  assert.ok(observedAt && observedAt.getFullYear() === 2026, "ReferenceDate parsed");
  console.log(`✓ 特別交通消息: ${items.length} 則，最新 ${observedAt?.toISOString()}`);
  console.log(`    首則：${items[0]!.title.slice(0, 60)}…`);
}

// 3. WSD Big5 pipe CSV — THE gate source.
{
  const text = P.decodeBig5(fx("wsd_water_suspension.csv"));
  assert.ok(text.includes("東區"), "Big5 decoded to real Chinese");
  const { records, active, items } = P.parseWsd(text);
  assert.ok(records.length > 100, `records: ${records.length}`);
  assert.ok(active.length >= 1, `active suspensions: ${active.length}`);
  assert.ok(active.every((r) => r.status === "現正停水"), "active filter is exact");
  assert.equal(items.length, active.length);
  const a = active[0]!;
  console.log(`✓ 停水: ${records.length} 記錄，${active.length} 現正停水`);
  console.log(`    首宗：${a.district} ${a.address.slice(0, 40)}（${a.waterType}·${a.nature}）`);
  console.log(`    時間：${items[0]!.time}`);
}

// 4. ImmD queues — 6 stations from panel params.
{
  const cells = P.parseImmdQueue(JSON.parse(fx("immd_cp_queue.json").toString("utf8")), ["HYW", "HZM", "LMC", "LSC", "LWS", "MKT"]);
  assert.equal(cells.length, 6);
  assert.ok(cells.some((c) => c.label === "羅湖"), "LWS = 羅湖");
  assert.ok(cells.every((c) => c.status === 0), "all smooth in the capture (all 0 min)");
  console.log("✓ 口岸: 6 個管制站，全部暢順（0 分鐘）");
}

// 5. Ferry CSV.
{
  const { columns, rows } = P.parseFerry(fx("ferry_arrival_tc.csv").toString("utf8"), 20);
  assert.equal(columns[0], "抵達時間");
  assert.ok(rows.length >= 2 && rows[0]!.length === 5, `${rows.length} ferry rows × 5 cols`);
  console.log(`✓ 渡輪: ${rows.length} 班，首班 ${rows[0]!.join(" | ")}`);
}

// 6. HKIA flights.
{
  const { columns, rows, observedAt } = P.parseFlights(JSON.parse(fx("hkia_flights.json").toString("utf8")), 40);
  assert.equal(columns.length, 4);
  assert.ok(rows.length > 10, `${rows.length} flight rows`);
  assert.ok(observedAt !== null, "lastUpdatedTime parsed");
  console.log(`✓ 航班: ${rows.length} 行，首行 ${rows[0]!.join(" | ")}，更新 ${observedAt?.toISOString()}`);
}

// 7. A&E waiting — level mapping from the source's own strings.
{
  const { cells } = P.parseAeWaiting(JSON.parse(fx("ae_waiting.json").toString("utf8")));
  assert.ok(cells.length >= 15, `${cells.length} hospitals`);
  const kwongWah = cells.find((c) => c.label === "廣華醫院")!;
  assert.equal(kwongWah.level, "alert", "廣華 4 小時 → alert");
  console.log(`✓ 急症室: ${cells.length} 醫院；廣華 ${kwongWah.value} → alert`);
}

// 8. Leave plan (prebuilt static JSON at the repo data dir).
{
  const plan = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data", "leave_plan.json"), "utf8"));
  const { rows, observedAt } = P.parseLeavePlan(plan, "2026", 10);
  assert.ok(rows.length > 0, `${rows.length} leave bridges for 2026`);
  console.log(`✓ 請假攻略 2026: ${rows.length} 個組合，最佳 ${rows[0]!.join(" | ")}（生成於 ${observedAt?.toISOString().slice(0, 10)}）`);
}

// 9. Rain nowcast grid.
{
  const grid = P.parseNowcast(fx("rain_nowcast.csv").toString("utf8"), [22.15, 113.83, 22.56, 114.44]);
  assert.ok(grid, "grid parsed");
  assert.ok(grid!.lats.length > 5 && grid!.lons.length > 5, `grid ${grid!.lats.length}×${grid!.lons.length}`);
  assert.ok(Math.min(...grid!.lats) >= 22.15 - 0.06 && Math.max(...grid!.lats) <= 22.56 + 0.06, "bbox respected");
  console.log(`✓ 降雨臨近預報: ${grid!.lats.length}×${grid!.lons.length} 格 @${grid!.step}°，時段 ${grid!.updated}→${grid!.ending}，最大 ${grid!.max}mm`);
}

// 10. TC list + track — live capture had DUJUAN 杜鵑 active.
{
  const tcs = P.parseTcList(fx("tc_list.xml").toString("utf8"));
  assert.equal(tcs.length, 1);
  assert.equal(tcs[0]!.tcName, "杜鵑");
  assert.ok(tcs[0]!.trackUrl.startsWith("https://"), "track URL upgraded to https");
  const track = P.parseTcTrack(fx("tc_track_2640.xml").toString("utf8"));
  assert.equal(track.enName, "DUJUAN");
  assert.ok(track.points.length >= 5, `${track.points.length} track points`);
  assert.equal(track.points[0]!.lat, 24.7);
  assert.equal(track.points[0]!.lon, 145.8);
  console.log(`✓ 熱帶氣旋: ${track.name} ${track.enName}，${track.points.length} 點，首點 ${track.points[0]!.lat}N ${track.points[0]!.lon}E`);
}

// 11. Radar URL slots are HKT-floored to 6 minutes.
{
  const cands = P.radarCandidates(new Date("2026-09-18T11:24:30Z")); // 19:24:30 HKT
  assert.ok(cands[0]!.url.includes("2d256nradar_202609181924.jpg"), `slot: ${cands[0]!.url}`);
  assert.ok(cands[1]!.url.includes("202609181918"), "fallback −6min");
  console.log(`✓ 雷達 URL: ${cands[0]!.url.slice(-40)} → ${cands[3]!.url.slice(-40)}`);
}

// 12. Time/duration helpers.
{
  assert.equal(P.parseTdDate(" 2026/9/19 下午 01:10:11")?.toISOString(), "2026-09-19T05:10:11.000Z");
  assert.equal(P.parseTdDate("2026/9/19 上午 12:05:00")?.toISOString(), "2026-09-18T16:05:00.000Z", "上午 12:xx = 00:xx HKT");
  assert.equal(P.parseHkDmY("17-09-2026 22:00")?.toISOString(), "2026-09-17T14:00:00.000Z");
  assert.equal(P.zhDurationMinutes("4 小時"), 240);
  assert.equal(P.zhDurationMinutes("少於 15 分鐘"), 15);
  assert.equal(P.zhDurationMinutes("1.5 小時"), 90);
  console.log("✓ 日期解析：TD 上下午格式、WSD DD-MM-YYYY、中文時長");
}

// 13. Yahoo quote — real captured HSI chart payload.
{
  const j = jx("yahoo_hsi.json");
  const q = P.parseYahooQuote(j);
  assert.ok(q && q.symbol === "^HSI", "symbol parsed");
  assert.ok(q.price > 0 && Number.isFinite(q.changePct), `price=${q.price} chg=${q.changePct}%`);
  assert.ok(q.spark.length >= 2, `sparkline ${q.spark.length} points`);
  console.log(`✓ 港股報價: ${q.symbol} ${q.price}（${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%）、spark ${q.spark.length} 點`);
}

// 14. RSS (gov news 治安 feed).
{
  const { items, observedAt } = P.parseRss(fx("gov_news_law_order.xml").toString("utf8"), 25);
  assert.ok(items.length > 0, `${items.length} news items`);
  assert.ok(items.every((i) => i.title.length > 5), "titles are real text");
  console.log(`✓ 突發新聞 RSS: ${items.length} 則，最新 ${observedAt?.toISOString()}`);
  console.log(`    首則：${items[0]!.title.slice(0, 60)}`);
}

// 15. CoinGecko.
{
  const { rows } = P.parseCoingecko(jx("coingecko.json"), ["bitcoin", "ethereum"]);
  assert.equal(rows.length, 2);
  assert.ok(rows[0]![1] !== "—", "BTC price present");
  console.log(`✓ 加密貨幣: BTC ${rows[0]![1]} HKD, ETH ${rows[1]![1]} HKD`);
}

// 16. AQHI city dashboard.
{
  const { cells, observedAt } = P.parseAqhiDashboard(jx("aqhi_city_dashboard.json"));
  assert.ok(cells.length >= 15, `${cells.length} AQHI stations`);
  assert.ok(cells.every((c) => c.level === "ok" || c.level === "warn" || c.level === "alert"));
  assert.ok(observedAt !== null, "publish_date parsed");
  console.log(`✓ AQHI: ${cells.length} 站，風險級別全齊，更新 ${observedAt?.toISOString().slice(0, 16)}`);
}

// 17. Carpark merge.
{
  const v = jx("carpark_vacancy.json");
  const i = jx("carpark_basic_info.json");
  const rows = P.parseCarpark(v, i, 12);
  assert.ok(rows.length > 0, `${rows.length} carparks`);
  assert.ok(rows.every((r) => r.name.length > 0), "names present");
  console.log(`✓ 停車場: ${rows.length} 個（空位最高優先），首個 ${rows[0]!.name} ${rows[0]!.vacancy}/${rows[0]!.capacity}`);
}

// 18. ImmD queue: 0-minute sentinel displays as the 少於 15 分鐘 band (bug #2).
{
  const cells = P.parseImmdQueue({ HYW: { arrQueue: 0, depQueue: 0 }, LWS: { arrQueue: 25, depQueue: 18 } }, ["HYW", "LWS"]);
  assert.ok(cells[0]!.value.includes("少於 15 分鐘") || cells[0]!.value.includes("< 15"), `0 → 少於 15 分鐘, got: ${cells[0]!.value}`);
  assert.equal(cells[1]!.status, 1, "25 分鐘 → warn band");
  console.log(`✓ 口岸顯示: 0 分鐘 → 「少於 15 分鐘」；25 分鐘 → amber（${cells[1]!.value}）`);
}

// 19. ImmD 99 sentinel → CLOSED, not a red "99 分鐘" queue (P0-3, measured in
// the 23:00 screenshot: 香園圍/落馬洲支線/文錦渡 showed red 99-min queues
// while their crossings were merely shut for the night).
{
  const cells = P.parseImmdQueue(
    { HYW: { arrQueue: 99, depQueue: 99 }, LSC: { arrQueue: 99, depQueue: 0 }, LWS: { arrQueue: 10, depQueue: 8 } },
    ["HYW", "LSC", "LWS"],
  );
  assert.equal(cells[0]!.status, 3, "99 → closed state");
  assert.ok(cells[0]!.value.includes("已關閉") || cells[0]!.value.includes("Closed"), `value=${cells[0]!.value}`);
  assert.equal(cells[1]!.status, 3, "one side 99 still means closed");
  assert.equal(cells[2]!.status, 0, "open crossing unaffected");
  console.log(`✓ 口岸 99: 已關閉（灰）唔係「99 分鐘」（紅）；開放站正常（${cells[2]!.value}）`);
}

// 20. Ferry observedAt derives from the ROW dates, not the fetch time (P0-4):
// a fresh request returning May rows must come out stale already.
{
  const { rows, observedAt } = P.parseFerry(
    "抵達時間|出發地|營運公司|碼頭|泊位|現況\n2026-05-13 09:05|中山|珠江客運|中港碼頭|6|已抵達\n2026-05-13 09:30|澳門|噴射飛航|港澳碼頭|2|已抵達",
    10,
  );
  assert.equal(rows.length, 2);
  assert.equal(observedAt?.toISOString(), "2026-05-13T01:30:00.000Z", "latest row date, 09:30+08:00");
  console.log(`✓ 渡輪 observedAt = 最新行日期（${observedAt?.toISOString()}，唔係 fetch 時間）`);
}

// 21. Relative-time helper: bare ISO stamps → 前 ages; junk passes through.
{
  const { relTime } = await import("./format.ts");
  const now = new Date("2026-09-21T12:00:00+08:00");
  assert.ok(relTime("2026-09-19 10:00", now).includes("日前"), relTime("2026-09-19 10:00", now));
  assert.equal(relTime("random string", now), "random string");
  console.log(`✓ 相對時間: ${relTime("2026-09-19 10:00", now)} / 原格式 pass-through`);
}

// 22. RTHK RSS — the ticker's third channel, real capture via the proxy.
{
  const { items, observedAt } = P.parseRss(fx("rthk_local.xml").toString("utf8"), 25);
  assert.ok(items.length >= 5, `${items.length} rthk items`);
  assert.ok(items.every((i) => i.title.length > 4), "real titles");
  assert.ok(observedAt !== null && observedAt.getFullYear() === 2026, "pubDate parsed");
  console.log(`✓ RTHK RSS: ${items.length} 則，最新 ${observedAt?.toISOString()}；首則「${items[0]!.title.slice(0, 30)}」`);
}

// 23. ADS-B aircraft — TWO feeds, TWO envelope keys, TWO timestamp units.
// This is the case that would silently ship: adsb.fi wraps its list in
// `aircraft` and stamps `now` in SECONDS, adsb.lol wraps the same records in
// `ac` and stamps `now` in MILLISECONDS. Reading either key wrongly yields an
// empty map, which reads as "no aircraft over Hong Kong" — the most misleading
// possible failure for a live traffic layer.
{
  const fi = P.parseAdsb(jx("adsb_fi_hk.json"));
  const lol = P.parseAdsb(jx("adsb_lol_hk.json"));

  assert.ok(fi.aircraft.length > 0, `adsb.fi envelope 'aircraft' read (${fi.aircraft.length})`);
  assert.ok(lol.aircraft.length > 0, `adsb.lol envelope 'ac' read (${lol.aircraft.length})`);

  // 1e11 is the seconds/milliseconds divide. Both live captures are ~2026, so
  // both must land in 2026 — a unit mix-up shows up as 1970 here.
  assert.equal(fi.observedAt?.getFullYear(), 2026, `adsb.fi seconds -> ${fi.observedAt?.toISOString()}`);
  assert.equal(lol.observedAt?.getFullYear(), 2026, `adsb.lol milliseconds -> ${lol.observedAt?.toISOString()}`);

  const a = fi.aircraft[0]!;
  assert.ok(a.hex.length > 0, "hex present");
  assert.ok(a.lat > 22 && a.lat < 22.6 && a.lon > 113 && a.lon < 114.5, `in HK bbox ${a.lat},${a.lon}`);
  assert.ok(a.altFt !== null && a.altFt > 0, `altitude ${a.altFt}`);
  assert.ok(a.trackDeg !== null && a.trackDeg >= 0 && a.trackDeg <= 360, `track ${a.trackDeg}`);
  // Callsigns arrive space-padded; trailing spaces would break equality checks
  // and look wrong in the popup.
  assert.ok(!/\s$/.test(a.flight) || a.flight === "", `callsign trimmed (${JSON.stringify(a.flight)})`);

  // "ground" is NOT altitude 0 — plotting it at 0 puts an apron aircraft mid-air.
  const onGround = P.parseAdsb({ ac: [{ hex: "abc123", lat: 22.3, lon: 114.1, alt_baro: "ground", gs: 4 }] });
  assert.equal(onGround.aircraft[0]!.altFt, null, "alt_baro 'ground' -> null, not 0");
  assert.equal(onGround.aircraft[0]!.onGround, true, "onGround flag");

  // A record with no position must be dropped, not plotted at 0,0.
  const bad = P.parseAdsb({ aircraft: [{ hex: "no-pos" }, { hex: "ok", lat: 22.3, lon: 114.1, alt_baro: 1000 }] });
  assert.equal(bad.aircraft.length, 1, "records without lat/lon dropped");

  // The map layer reads `bearing` off the feature to rotate the plane glyph, so
  // the conversion has to carry it — a missing bearing draws every aircraft
  // pointing north, which looks plausible and is wrong.
  const gj = P.aircraftToGeoJson(fi.aircraft);
  assert.equal(gj.features.length, fi.aircraft.length, "one feature per aircraft");
  const f0 = gj.features[0]!;
  assert.equal(f0.geometry.type, "Point", "point geometry");
  const coords = (f0.geometry as GeoJSON.Point).coordinates;
  assert.ok(Math.abs(coords[0]! - a.lon) < 1e-9 && Math.abs(coords[1]! - a.lat) < 1e-9, "lon,lat order");
  assert.equal(f0.properties!["bearing"], a.trackDeg, "bearing carried for icon-rotate");
  // No-track aircraft keep a default bearing rather than being dropped: hiding
  // one would understate what is in the air.
  const noTrack = P.aircraftToGeoJson([{ hex: "x1", flight: "", lat: 22.3, lon: 114.1, altFt: 100, onGround: false, gsKt: null, trackDeg: null, verticalFpm: null }]);
  assert.equal(noTrack.features[0]!.properties!["bearing"], 0, "missing track -> bearing 0, not dropped");

  console.log(`✓ ADS-B: fi ${fi.aircraft.length} 架（aircraft 鍵·秒）· lol ${lol.aircraft.length} 架（ac 鍵·毫秒）`);
  console.log(`    樣本 ${a.flight || a.hex} · ${a.altFt} ft · ${a.trackDeg}° · ${a.gsKt} kt · GeoJSON ${gj.features.length} 點`);
}

// 24. HKO 10-minute wind — the payload's fields are NOT all numbers, and the
// difference between "calm" and "no reading" is the difference between a real
// observation and an invented one. The fixture holds all three cases.
{
  const { stations, observedAt } = P.parseWindCsv(fx("hko_10min_wind.csv").toString("utf8"));
  assert.ok(stations.length >= 25, `${stations.length} stations`);

  const byName = new Map(stations.map((s) => [s.name, s]));

  const cheungChau = byName.get("Cheung Chau");
  assert.ok(cheungChau, "Cheung Chau present");
  assert.equal(cheungChau!.dirDeg, 90, "East → 90°");
  assert.equal(cheungChau!.speedKmh, 18, "speed parsed");
  assert.equal(cheungChau!.gustKmh, 27, "gust parsed");

  // "N/A" direction with a real speed: the speed is usable, the direction is
  // NOT. Defaulting it to 0 would draw a northerly wind that does not exist.
  const green = byName.get("Green Island");
  assert.ok(green, "Green Island present");
  assert.equal(green!.dirDeg, null, "N/A direction → null, not 0");
  assert.equal(green!.speedKmh, 27, "N/A direction still yields its speed");

  // "Calm" is not the number 0 — it is a state, and its direction field is
  // meaningless. Treating it as 0 km/h from due north invents an observation.
  const wetland = byName.get("Wetland Park");
  assert.ok(wetland, "Wetland Park present");
  assert.equal(wetland!.speedKmh, null, "Calm → null, not 0");
  assert.equal(wetland!.dirDeg, null, "Calm direction → null");

  assert.equal(observedAt?.getFullYear(), 2026, `timestamp parsed (${observedAt?.toISOString()})`);

  // The summary must disclose the gap, not paper over it.
  const cells = P.windStatus(stations);
  const noDirCell = cells.find((c) => c.label.includes("無風向") || c.label.includes("direction"));
  assert.ok(noDirCell, "summary reports stations with no direction");
  assert.ok(Number(noDirCell!.value) >= 1, `no-direction count = ${noDirCell!.value}`);

  console.log(`✓ 10 分鐘風: ${stations.length} 站 · ${cells[0]!.value} 有完整風數據 · 無風向 ${noDirCell!.value} 站`);
  console.log(`    樣本：${cheungChau!.name} ${cheungChau!.dirText} ${cheungChau!.speedKmh} km/h（陣風 ${cheungChau!.gustKmh}）`);

  // --- the join to the CSDI station network ---------------------------------
  // The wind CSV has NAMES; the coordinates live in a separate dataset. The
  // join is where an invented reading could sneak in, so assert the exact
  // shortfall rather than just "some stations came back".
  const net = jx("hko_stations_network.json");
  const joined = P.joinWindToStations(stations, net);
  // NOT an arbitrary floor. At 02:10 on a calm autumn night most stations
  // report "Calm" or an N/A direction, so only a minority carry a usable
  // wind vector — measured 13 of 30 on the capture day. A high floor here
  // would fail on calm nights and push someone to loosen the parser (i.e.
  // to invent calm air as a real direction), which is the failure this
  // whole layer is built to avoid. Assert the invariants instead.
  assert.ok(joined.located.length > 0, `${joined.located.length} stations located`);
  assert.ok(
    joined.located.every((s) => typeof s.lon === "number" && typeof s.lat === "number"),
    "every located station has coordinates",
  );
  // Nothing that contributes to the field may lack a direction or speed — a
  // zero/absent reading in a vector field is an invented arrow.
  assert.ok(
    joined.located.every((s) => s.dirDeg !== null && s.speedKmh !== null && s.speedKmh > 0),
    "no calm / no-direction station entered the field",
  );
  // The two documented aliases must resolve, or they were written wrongly.
  assert.ok(joined.located.some((s) => s.name === "Chek Lap Kok"), "alias: Chek Lap Kok → HKIA");
  assert.ok(joined.located.some((s) => s.name === "Star Ferry"), "alias: Star Ferry(Kowloon)");
  // And the genuinely-missing ones must be REPORTED, not silently gone.
  assert.deepEqual(
    [...joined.droppedNoCoord].sort(),
    ["Hong Kong Sea School", "North Point"],
    "the two absent-from-CSDI stations are the only ones dropped for coordinates",
  );
  assert.ok(joined.droppedNoWind.length > 0, `dropped (no wind): ${joined.droppedNoWind.length}`);
  assert.equal(
    joined.located.length + joined.droppedNoCoord.length + joined.droppedNoWind.length,
    stations.length,
    "every station is either located or explicitly dropped — none vanish",
  );

  console.log(`    落圖：${joined.located.length} 站有座標+風 · 無座標 ${joined.droppedNoCoord.length}（${joined.droppedNoCoord.join("、")}）· 無風 ${joined.droppedNoWind.length}`);
}

console.log("\nparsers.test.ts: ALL PASS");


// --- transport panels (fixtures captured from the live endpoints) ----------------

// MTR next train: 4 UP + 4 DOWN on ISL at ADM; sys_time carries no T, no timezone.
{
  const j = jx("mtr_schedule.json");
  const { items, observedAt } = P.parseMtrSchedule(j);
  assert.equal(items.length, 8, `8 班（4 UP + 4 DOWN），實得 ${items.length}`);
  assert.ok(items.every((i) => i.title.startsWith("往") || i.title.startsWith("to ")), "每班都有目的地");
  assert.ok(items.some((i) => /\d+ 分鐘/.test(i.time ?? "") || i.time === "即將"), "有到站分鐘");
  assert.ok(observedAt instanceof Date, "sys_time 解析到（無 T、無時區）");
  console.log(`✓ 港鐵下一班: ${items.length} 班；首班 ${items[0]!.title} · ${items[0]!.time}`);
}

// KMB arrivals at one stop. The 備註 column is the honesty point of this panel.
{
  const j = jx("kmb_stop_eta.json");
  const { columns, rows, observedAt } = P.parseKmbStopEta(j);
  assert.ok(rows.length > 0, `${rows.length} 行`);
  assert.equal(columns.length, 4, "4 欄（路線／目的地／到站／備註）");
  assert.ok(rows.every((r) => r.length === 4), "每行 4 格");
  assert.ok(observedAt instanceof Date, "generated_timestamp 解析到（ISO +08:00）");
  const gen = new Date(j.generated_timestamp).getTime();
  const want = Math.round((new Date(j.data[0].eta).getTime() - gen) / 60000);
  assert.equal(rows[0]![2], want <= 0 ? "即將" : String(want), `到站分鐘 = eta − generated（期望 ${want}）`);
  // The fixture itself must carry a remark, or this test proves nothing.
  const rmkCount = j.data.filter((d: { rmk_tc?: string }) => d.rmk_tc).length;
  assert.ok(rmkCount > 0, "fixture 要有 rmk 值，否則呢個測試測唔到嘢");
  assert.ok(rows.some((r) => r[3] && r[3]!.length > 0), "rmk 有顯示，冇被 drop");
  console.log(`✓ 九巴到站: ${rows.length} 行；備註有顯示（例：${rows.find((r) => r[3])?.[3]}）`);
}
