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

console.log("\nparsers.test.ts: ALL PASS");
