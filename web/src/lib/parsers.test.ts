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
const F = await import("./format.ts");
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

  // Every district name must be TRIMMED. The district is joined against the CSDI
  // polygon layer by exact string equality, and CSDI itself publishes 深水埗區
  // with a trailing CRLF (measured on feature OBJECTID 6). An untrimmed name on
  // either side means the affected district silently never highlights on the map
  // — a failure that looks like "no water outage here" rather than an error.
  const untrimmed = records.filter((r) => r.district !== r.district.trim());
  assert.equal(untrimmed.length, 0, `all district names trimmed (found ${untrimmed.length})`);
  assert.ok(records.every((r) => !/[\r\n\t]/.test(r.district)), "no control chars in district names");
  // And the synthetic case, since the real fixture may happen to be clean: a CRLF
  // inside a field must not split the record. The upstream data really contains
  // this (CSDI publishes 深水埗區 as "深水埗區\r\n"), and a naive split-on-newline
  // turned one record into two short lines that both failed the 15-column check,
  // so the record disappeared with no error at all.
  //
  // The header must be a WELL-FORMED 15-column row, otherwise the rejoin logic
  // (correctly) treats the header itself as a continuation and swallows it.
  const hdr = Array.from({ length: 15 }, (_, i) => `h${i}`).join("|");
  const cols = Array.from({ length: 15 }, (_, i) => `c${i}`);
  cols[4] = "深水埗區\r\n";
  cols[14] = "現正停水";
  const dirty = P.parseWsd(`${hdr}\n${cols.join("|")}\n`);
  assert.equal(dirty.records.length, 1, "a CRLF inside a field does not split the record");
  assert.equal(dirty.records[0]?.district, "深水埗區", "CRLF stripped from district");
  assert.equal(dirty.records[0]?.status, "現正停水", "status survives the rejoin");
  console.log(`    分區名全部 trimmed（${records.length} 筆），CRLF 會剝走`);
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
  // >= 20, not >= 2. The old bound passed on a fixture with 5 points while the
  // adapter's real query returned 1 — the fixture hid the bug. An intraday
  // series at 5-minute bars is ~70 points; anything near single digits means the
  // query changed back to a daily interval and the sparkline cannot draw.
  assert.ok(q.spark.length >= 20, `sparkline ${q.spark.length} points（5 分鐘 bar 應該有幾十點）`);
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

// 17. Carpark merge — re-derived from the RAW fixture, not from the parser.
//
// The old version of this block asserted `rows.length > 0`, that names were
// present, and printed `${vacancy}/${capacity}`. It passed for as long as the
// panel has existed while the panel was showing a 總數 column of "—" for every
// row and an ordering that had never sorted anything — because `capacity` does
// not exist in `basic_info_all.json`, so the ratio key was Infinity for every row
// and `br - ar` was NaN. Printing "2/0" reads as fine.
//
// The expectation is therefore computed HERE, from the fixture's own records,
// independently of parseCarpark — the same "cross-check against the raw data, not
// against itself" rule the district check had to learn (Pitfall 19).
{
  const v = jx("carpark_vacancy.json") as {
    car_park: { park_id: string; vehicle_type?: { type?: string; service_category?: { vacancy?: number; lastupdate?: string }[] }[] }[];
  };
  const i = jx("carpark_basic_info.json") as { car_park: { park_id: string; name_tc?: string; name_en?: string }[] };

  // 1. The feed does NOT carry capacity. If a future capture adds it, this fails
  //    and the 總數 column can come back — deliberately, because the column was
  //    removed on the strength of this fact.
  const infoKeys = new Set(i.car_park.flatMap((p) => Object.keys(p)));
  assert.ok(!infoKeys.has("capacity"), "basic_info_all.json still has no capacity field (the 總數 column's premise)");

  // 2. Expected private-car vacancy, per park, from the raw records.
  const expected = new Map<string, number>();
  let multiType = 0;
  for (const p of v.car_park) {
    if ((p.vehicle_type ?? []).length > 1) multiType++;
    let sum = 0;
    for (const vt of p.vehicle_type ?? []) {
      if (vt.type !== "P") continue;
      for (const sc of vt.service_category ?? []) sum += Number(sc.vacancy) || 0;
    }
    expected.set(p.park_id, sum);
  }
  // The summing bug needs more than one vehicle type to be observable at all.
  assert.ok(multiType > 0, `${multiType} car parks carry >1 vehicle_type, so the P-only rule is testable`);

  // 3. If any park has a non-P type carrying vacancy, summing all types would
  //    differ — assert that this is a real distinction in this fixture.
  const differs = v.car_park.some((p) => {
    const all = (p.vehicle_type ?? []).reduce(
      (a, vt) => a + (vt.service_category ?? []).reduce((x, sc) => x + (Number(sc.vacancy) || 0), 0),
      0,
    );
    return all !== (expected.get(p.park_id) ?? 0);
  });
  assert.ok(differs, "at least one park reports non-private-car vacancy, so P-only changes the number");

  const MAX = 12;
  const rows = P.parseCarpark(v, i, MAX);
  assert.equal(rows.length, MAX, `${MAX} rows`);

  // 4. Every row's vacancy is the value derived above, and every row is private-car.
  const wrong = rows.filter((r) => r.vacancy !== (expected.get(r.id) ?? -1));
  assert.equal(wrong.length, 0, `vacancy must be the private-car sum (mismatches: ${wrong.map((r) => r.id).join(",")})`);

  // 5. The panel claims "most free spaces first". Prove the sort ran: take the
  //    top-12 by vacancy straight from the raw data and require the same ids.
  const topExpected = i.car_park
    .filter((p) => expected.has(p.park_id))
    .map((p) => ({ id: p.park_id, name: (p.name_tc ?? p.name_en)!, vacancy: expected.get(p.park_id)! }))
    .sort((a, b) => b.vacancy - a.vacancy || a.name.localeCompare(b.name, "zh-Hant"))
    .slice(0, MAX)
    .map((r) => r.id);
  assert.deepEqual(rows.map((r) => r.id), topExpected, "rows are the top-N by private-car vacancy");

  // 6. Descending, and no row carries capacity any more.
  assert.ok(rows.every((r, n) => n === 0 || rows[n - 1]!.vacancy >= r.vacancy), "vacancy descending");
  assert.ok(!("capacity" in rows[0]!), "CarparkRow no longer carries capacity");

  // 7. Per-park report times parsed (the panel shows them per row).
  const timed = rows.filter((r) => r.updatedAt instanceof Date && Number.isFinite(r.updatedAt.getTime()));
  assert.ok(timed.length > 0, `${timed.length}/${rows.length} rows carry a parsed report time`);

  // 8. Coordinates ride along as a PAIR or not at all — this is the entire input of the carpark
  //    map layer, so it is pinned here rather than left to the panel (which ignores them).
  //    The fixture is a faithful capture of `basic_info_all` and DOES carry latitude/longitude for
  //    every park (that is why an earlier draft of this check, asserting they were all absent,
  //    failed) — so the live path is asserted from the fixture and the REJECTION paths
  //    synthetically: a half-pair coerced into a number puts the car park at 0/0 in the Atlantic,
  //    which renders as a real position off the coast of Africa.
  const located = rows.filter((r) => r.lat !== null && r.lon !== null);
  assert.equal(located.length, rows.length, `${located.length}/${rows.length} rows carry a coordinate pair`);
  assert.ok(
    located.every((r) => r.lat! > 22.0 && r.lat! < 22.7 && r.lon! > 113.7 && r.lon! < 114.6),
    "every coordinate falls inside Hong Kong's bounding box",
  );
  const carRows = (parkRaw: Record<string, unknown>[]) =>
    P.parseCarpark(
      { car_park: parkRaw.map((p) => ({ park_id: p["park_id"], vehicle_type: [{ type: "P", service_category: [{ vacancy: 3 }] }] })) },
      { car_park: parkRaw },
      5,
    );
  const none = carRows([{ park_id: "z", name_tc: "冇座標場" }]);
  assert.deepEqual([none[0]!.lat, none[0]!.lon], [null, null], "no coordinate pair → null, never 0");
  const half = carRows([{ park_id: "y", name_tc: "半對場", latitude: 22.3247 }]);
  assert.equal(half[0]!.lat, null, "a lone latitude is not a position");
  assert.equal(half[0]!.lon, null, "a lone latitude implies no longitude either");

  console.log(
    `✓ 停車場: ${rows.length} 個（私家車空位最多優先）· 首位 ${rows[0]!.name} ${rows[0]!.vacancy} 個 · ` +
      `多車種場 ${multiType} 個（只用 P 種）· 有時間戳 ${timed.length}/${rows.length} · ` +
      `座標: 一對先算（半對→null）`,
  );

  // 17b. carparkToGeoJson — the map layer's view of the same rows.
  const fc = P.carparkToGeoJson(rows);
  assert.equal(fc.type, "FeatureCollection");
  // Every located row becomes a point; the synthetic no-coord rows stay in the
  // table and OFF the map.
  assert.equal(fc.features.length, rows.length, "all located rows drawn");
  const first = fc.features[0] as GeoJSON.Feature<GeoJSON.Point, { id?: string; name?: string; vacancy?: number; updated?: string }>;
  assert.equal(first.geometry.type, "Point");
  const [lon, lat] = first.geometry.coordinates;
  assert.ok(lat! > 22.0 && lat! < 22.7 && lon! > 113.7 && lon! < 114.6, "feature coordinates inside HK");
  assert.equal(typeof first.properties!.id, "string");
  assert.equal(typeof first.properties!.vacancy, "number");
  // No-coordinate rows produce ZERO features between them.
  const onlyNoCoord = P.carparkToGeoJson([...none, ...half]);
  assert.equal(onlyNoCoord.features.length, 0, "parks without a pair are not drawn");
  console.log(
    `✓ 停車場圖層: ${fc.features.length} 個點（一對先算）；冇座標 0 點；properties 帶 id/name/vacancy/updated`,
  );
}

// 17c. 1-minute regional temperatures: CSV → station key → "26.8 13:30".
{
  const m = P.parse1MinTemp(
    "Date time,Automatic Weather Station,Air Temperature(degree Celsius)\n" +
      "202610061330,Cheung Chau,26.2\n" +
      "202610061330,Chek Lap Kok,26.8\n" +
      "202610061330,HK Observatory,26.7\n" +
      "202610061330,HK Park,26.9\n",
  );
  assert.equal(m.get(P.hkoStationKey("Cheung Chau")), "26.2 13:30", "plain name");
  assert.equal(m.get(P.hkoStationKey("HK Observatory")), "26.7 13:30", "HK Observatory → Hong Kong Observatory");
  assert.equal(m.get(P.hkoStationKey("HK Park")), "26.9 13:30", "HK Park → Hong Kong Park");
  assert.equal(m.get(P.hkoStationKey("Chek Lap Kok")), "26.8 13:30", "Chek Lap Kok → Hong Kong International Airport");
  assert.equal(
    P.hkoStationKey("Cheung Chau Automatic Weather Station"),
    P.hkoStationKey("Cheung Chau"),
    "suffix stripped",
  );
  console.log("✓ 1 分鐘氣溫: CSV 入 key（3 個縮寫 alias 對到 CSDI 官方名）");
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

// 23b. Vessel AIS (VesselAPI) — a 6-hourly snapshot, not live positions.
{
  const { vessels, observedAt } = P.parseVessels(jx("vessels.json"));
  assert.equal(vessels.length, 2, `${vessels.length} vessels`);
  assert.equal(vessels[0]!.mmsi, "477000001");
  assert.equal(vessels[0]!.name, "TEST CARGO", "vessel_name parsed");
  assert.equal(vessels[0]!.sog, 12.5, "sog parsed");
  assert.ok(observedAt && observedAt.getFullYear() === 2026, `timestamp parsed ${observedAt?.toISOString()}`);

  const gj = P.vesselsToGeoJson(vessels);
  assert.equal(gj.features.length, 2, "one feature per vessel");
  const f0 = gj.features[0]!;
  assert.equal(f0.properties!["bearing"], 180.2, "COG carried as bearing (icon-rotate)");
  assert.equal(f0.properties!["Name"], "TEST CARGO", "Name = vessel name for popup title");
  const f1 = gj.features[1]!;
  assert.equal(f1.properties!["bearing"], 0, "no COG/heading -> bearing 0, not dropped");
  assert.equal(f1.properties!["Name"], "477000002", "nameless vessel -> mmsi as Name");

  // No position -> dropped, not plotted at 0,0.
  const bad = P.parseVessels({ vessels: [{ mmsi: 1 }, { mmsi: 2, latitude: 22.3, longitude: 114.1 }] });
  assert.equal(bad.vessels.length, 1, "no-lat/lon dropped");

  const cells = P.vesselsStatus(vessels);
  assert.equal(cells[0]!.value, "2", "count cell");
  assert.equal(cells[1]!.value, "1/2", "named cell");

  console.log(`✓ 船隻: ${vessels.length} 艘，最新 ${observedAt?.toISOString()}；COG→bearing ${f0.properties!["bearing"]}°`);
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

  // EVERY direction the feed publishes must resolve — not a hand-picked pair.
  //
  // This is the assertion that was missing, and its absence is exactly how the
  // compass table stayed wrong: it carried full words only for North/East/South/
  // West and ABBREVIATIONS for the other twelve points, while the CSV publishes
  // full words throughout. MEASURED against the live file: "Southeast" appeared
  // 14 times, "East" 12, "Northeast" 2, "South" 1 — so only the last two matched,
  // 16 of 30 stations lost their bearing, the barb map silently drew 10 of 30, and
  // the panel's mean was 16.7 km/h against a true 14.6 over the stations that did
  // report. The single `East → 90` assertion above passed throughout.
  //
  // The set below is read from the FIXTURE — so it is the feed's own vocabulary,
  // not a list typed here — and any direction string that is a real compass point
  // must map to a number. Non-directions (N/A, Calm) must stay null.
  // The three words HKO uses for "there is no single bearing". These must stay
  // null — inventing a direction for `Variable` would draw a steady wind that the
  // instrument explicitly said it could not see. Everything else must resolve.
  //
  // The fixture's own vocabulary is: East x14, Southeast x7, Northeast x3, N/A x2,
  // Northwest x2, Variable x1, Calm x1 — i.e. 26 real bearings and 3 non-answers.
  // Under the old table only East matched, so 12 of those 26 were dropped.
  const NON_DIRECTIONS = new Set(["N/A", "Calm", "Variable", "", "-"]);
  const unresolved = stations.filter((s) => !NON_DIRECTIONS.has(s.dirText) && s.dirDeg === null);
  assert.equal(
    unresolved.length,
    0,
    `every compass point must resolve; unresolved: ${[...new Set(unresolved.map((s) => s.dirText))].join(", ")}`,
  );
  // And the reverse: a non-answer must NOT silently become a bearing.
  const invented = stations.filter((s) => NON_DIRECTIONS.has(s.dirText) && s.dirDeg !== null);
  assert.equal(invented.length, 0, `non-directions must stay null: ${invented.map((s) => s.dirText).join(", ")}`);
  // The three real bearings the old table lost — asserted by name so this cannot
  // regress via the fixture changing shape.
  assert.equal(byName.get("Cheung Chau")!.dirDeg, 90, "Cheung Chau East");
  const se = stations.find((s) => s.dirText === "Southeast");
  assert.equal(se?.dirDeg, 135, `"Southeast" → 135° (got ${se?.dirDeg})`);
  const nw = stations.find((s) => s.dirText === "Northwest");
  assert.equal(nw?.dirDeg, 315, `"Northwest" → 315° (got ${nw?.dirDeg})`);
  const ne = stations.find((s) => s.dirText === "Northeast");
  assert.equal(ne?.dirDeg, 45, `"Northeast" → 45° (got ${ne?.dirDeg})`);

  // The full 8-point rose, asserted by value, from a synthetic file — so a future
  // edit to the table cannot quietly drop a word the feed publishes only rarely.
  const ROSE: [string, number][] = [
    ["North", 0], ["Northeast", 45], ["East", 90], ["Southeast", 135],
    ["South", 180], ["Southwest", 225], ["West", 270], ["Northwest", 315],
  ];
  const roseCsv =
    "Date time,Automatic Weather Station,Dir,Speed,Gust\n" +
    ROSE.map(([w], i) => `202609250850,S${i},${w},10,20`).join("\n") +
    "\n";
  const rose = P.parseWindCsv(roseCsv).stations;
  ROSE.forEach(([word, deg], i) => {
    assert.equal(rose.find((s) => s.name === `S${i}`)?.dirDeg, deg, `"${word}" → ${deg}°`);
  });

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
  // The MERGE order across lines. Sorting the display label lexically puts "11 分鐘" before
  // "7 分鐘" — a measured bug (2026-10-06) that made the list look unsorted at exactly the
  // multi-line stations people track. "即將" means due, so it sorts first.
  const merged = ["11 分鐘", "7 分鐘", "即將", "20 分鐘"].sort((a, b) => P.minsFromLabel(a) - P.minsFromLabel(b));
  assert.deepEqual(merged, ["即將", "7 分鐘", "11 分鐘", "20 分鐘"], `合併排序要按數字：${merged.join(" < ")}`);
  console.log(`✓ 港鐵下一班: ${items.length} 班；首班 ${items[0]!.title} · ${items[0]!.time} · 合併排序按數字`);
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


// 25. List rows carry HKT wall times, not UTC — the producer/consumer contract.
//
// MEASURED 2026-09-25: `parseTrafficNews` and `parseGovNews` built each row's
// `time` with `date.toISOString().slice(0, 16)`, which is UTC, while `relTime`
// parses that string as +08:00. Every row therefore printed eight hours early and
// aged eight hours fast: TD ReferenceDate 17:02:37 HKT became a row reading
// "2026-09-25 09:02" under a footer clock saying 17:02, and the news rows shifted
// far enough that `breaking_news_list`'s 24h tolerance latched the panel stale
// while the feed's own lastBuildDate was two minutes old.
//
// This asserts the CONTRACT rather than either implementation: whatever produces
// the string, re-reading it must give back the same instant.
{
  const at = new Date("2026-09-25T09:02:00Z"); // 17:02 HKT
  assert.equal(F.hkWallTime(at), "2026-09-25 17:02", "a UTC instant formats as HKT wall time");

  const threeMinLater = new Date(at.getTime() + 3 * 60_000);
  const right = F.relTime(F.hkWallTime(at), threeMinLater);
  assert.ok(/3/.test(right) && /分|min/.test(right), `a 3-minute-old row reads as minutes, got "${right}"`);

  // Midnight must not become hour 24 (`hour12:false` can emit "24").
  assert.equal(F.hkWallTime(new Date("2026-09-24T16:00:00Z")), "2026-09-25 00:00", "midnight → 00:00, not 24:00");

  // A check that cannot fail is worse than none: prove this test can tell the two
  // formatters apart by running the OLD one and showing it reads as hours.
  const oldUtc = at.toISOString().slice(0, 16).replace("T", " ");
  const wrong = F.relTime(oldUtc, threeMinLater);
  assert.ok(/8/.test(wrong) && /小時|h ago/.test(wrong), `the old UTC formatter must read as 8 hours — got "${wrong}"`);
  console.log(`✓ 時間戳: HKT 牆上時間（${F.hkWallTime(at)}）· 舊 UTC 寫法會變「${wrong}」`);
}


// 26. The A&E update stamp is Chinese, and it used to parse to NULL.
//
// MEASURED 2026-09-25 against the live feed: `updateTime` is
// "2026年9月25日 下午6時15分", and this was fed to `new Date()`, which cannot parse
// it — so `observedAt` was ALWAYS null. The panel therefore had no clock at all
// and could never degrade, meaning a frozen Hospital Authority feed would look
// live forever. That is constraint 2 ("never present stale data as live") failing
// silently, and the fixture carries the same string, so one assertion would have
// caught it. None existed.
{
  const s = "2026年9月25日 下午6時15分";
  const at = P.parseHkChineseDate(s);
  assert.ok(at instanceof Date, `"${s}" must parse (got ${at})`);
  // 18:15 HKT === 10:15Z. Asserting the INSTANT, not the string, so a timezone
  // slip cannot pass.
  assert.equal(at!.toISOString(), "2026-09-25T10:15:00.000Z", "下午6時15分 → 18:15 HKT");

  // The 12-hour edges, where a naive `+12` is wrong: 上午12時 is midnight and
  // 下午12時 is noon.
  assert.equal(P.parseHkChineseDate("2026年1月1日 上午12時5分")!.toISOString(), "2025-12-31T16:05:00.000Z", "上午12時 → 00:05");
  assert.equal(P.parseHkChineseDate("2026年1月1日 下午12時30分")!.toISOString(), "2026-01-01T04:30:00.000Z", "下午12時 → 12:30");
  assert.equal(P.parseHkChineseDate("2026年12月31日 下午11時59分")!.toISOString(), "2026-12-31T15:59:00.000Z", "下午11時 → 23:59");
  // A minute field is optional in the wild; do not return null without one.
  assert.ok(P.parseHkChineseDate("2026年9月25日 下午6時") instanceof Date, "hour-only stamp still parses");
  // And a non-date must still be null rather than "now".
  assert.equal(P.parseHkChineseDate("not a date"), null, "unparseable → null, never a guess");

  // The wiring, not just the helper: the parser that produced the null must use it.
  const live = { waitTime: [], updateTime: s };
  const { observedAt } = P.parseAeWaiting(live);
  assert.ok(observedAt instanceof Date, "parseAeWaiting must carry the stamp through");
  console.log(`✓ 急症室時間: ${s} → ${at!.toISOString()}（12 小時制邊界同 null 都測齊）`);

  // MTR train position estimate — linear interpolation along a line
  {
    const mtr = {
      stations: {
        A: { code: "A", name_tc: "甲", name_en: "A", lat: 22.0, lon: 114.0 },
        B: { code: "B", name_tc: "乙", name_en: "B", lat: 22.1, lon: 114.1 },
        C: { code: "C", name_tc: "丙", name_en: "C", lat: 22.2, lon: 114.2 },
      },
      lines: { L: { name_tc: "L", name_en: "L", DT: ["A", "B", "C"], UT: ["C", "B", "A"], branches: [] } },
      travel_min: 2.5,
    };
    const at = P.estimateMtrTrains([{ line: "L", dir: "DOWN" as const, dest: "C", ttnt: 0 }], mtr);
    assert.equal(at.length, 1, "one train");
    assert.ok(Math.abs(at[0]!.lat - 22.2) < 0.001 && Math.abs(at[0]!.lon - 114.2) < 0.001, `ttnt 0 → terminus C, got ${at[0]!.lat},${at[0]!.lon}`);
    const mid = P.estimateMtrTrains([{ line: "L", dir: "DOWN" as const, dest: "C", ttnt: 2.5 }], mtr);
    assert.ok(Math.abs(mid[0]!.lat - 22.1) < 0.001 && Math.abs(mid[0]!.lon - 114.1) < 0.001, `ttnt 2.5 → station B, got ${mid[0]!.lat},${mid[0]!.lon}`);
    assert.equal(P.estimateMtrTrains([{ line: "L", dir: "DOWN" as const, dest: "C", ttnt: 99 }], mtr).length, 0, "ttnt beyond line → dropped");
    console.log(`✓ 港鐵推算: ttnt 0 → 終點，ttnt 2.5 → 一站前，超線 → 丟棄`);

    // Curved line: heading must track the CURRENT segment, not the terminus —
    // a train eastbound on a corner that points at its NE destination drifts sideways.
    const corner = {
      stations: {
        A: { code: "A", name_tc: "甲", name_en: "A", lat: 22.0, lon: 114.0 },
        B: { code: "B", name_tc: "乙", name_en: "B", lat: 22.0, lon: 114.1 },
        C: { code: "C", name_tc: "丙", name_en: "C", lat: 22.1, lon: 114.1 },
      },
      lines: { L: { name_tc: "L", name_en: "L", DT: ["A", "B", "C"], UT: ["C", "B", "A"], branches: [] } },
      travel_min: 2.5,
    };
    const tr = P.estimateMtrTrains([{ line: "L", dir: "DOWN" as const, dest: "C", ttnt: 3.75 }], corner);
    assert.equal(tr.length, 1, "one train mid-corner");
    assert.ok(Math.abs(tr[0]!.heading - 90) < 1, `heading along A→B, got ${tr[0]!.heading} (want ~90°)`);
    console.log(`✓ 港鐵 heading 沿線段: ${tr[0]!.heading.toFixed(1)}°（直角轉彎唔指向終點）`);
  }
}
