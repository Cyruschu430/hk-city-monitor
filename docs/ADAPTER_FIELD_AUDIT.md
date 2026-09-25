# Adapter / Parser Field Audit — does each wired parser read what the LIVE payload actually contains?

**Date:** 2026-09-25, 17:17–17:30 HKT
**Scope:** every adapter in `web/src/lib/adapters.ts` (`ADAPTERS`), the parsers it calls in
`web/src/lib/parsers.ts`, the panels in `data/panels.json`, the URLs in `sources.json`.
**Class of defect hunted:** a parser or adapter that reads a field, path or unit the LIVE payload
does not contain (or contains with different semantics), so the panel renders plausible-looking
but wrong, empty or degenerate data **with no error**. Template: the `parseCarpark()`
`base.capacity` bug.

**Method in one line:** enumerate the wired surface from the registries, fetch every source's
real URL with a browser User-Agent, then **run the real parser functions against the live
payloads** and print what they produce — measured, not inferred.

**Read-only.** Nothing in the repo was modified except this file. The throwaway harnesses live in
`%TEMP%\hkcm-audit\` (outside the repo) and are reproduced inline below.

---

## 1. Method and exact commands

### 1.1 Enumerate the wired surface mechanically (never a hand-typed list)

`%TEMP%\hkcm-audit\enumerate.mjs` — reads the adapter keys out of `adapters.ts`, the URLs out of
`sources.json`, the panels out of `data/panels.json`, and joins them:

```js
const adaptersSrc = readFileSync("C:/hk-city-monitor/web/src/lib/adapters.ts", "utf8");
const body = adaptersSrc.slice(adaptersSrc.indexOf("const ADAPTERS: Record<string, Adapter> = {"));
for (const line of body.split(/\r?\n/)) {
  const m = /^  (?:async )?([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line) || /^  (?:async )?([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
  if (m && m[1] !== "Adapter") ids.push(m[1]);
}
```

Raw output (`node enumerate.mjs`):

```
adapter count: 26

== wired adapters ==
mtr_next_train | browser | mtr_next_train_list | https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=ISL&sta=ADM
kmb_eta | browser | kmb_eta_table | https://data.etabus.gov.hk/v1/transport/kmb/eta/18492910339410B1/1/1
hko_warnsum | browser | warnings_list | https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc
td_specialtrafficnews | browser | special_traffic_list | https://resource.data.one.gov.hk/td/tc/specialtrafficnews.xml
wsd_water_suspension | n/a | water_suspension_list | https://www.esd.wsd.gov.hk/wsms_open_data/WSMS_OPEN_DATA(all).csv
immd_cp_queue | proxy | tp_queue_grid | https://secure1.info.gov.hk/immd/mobileapps/2bb9ae17/data/CPQueueTimeR.json
mardep_crossboundary_ferry | proxy | crossboundary_ferry_table | https://www.mardep.gov.hk/e_files/hk/opendata/arrival_tc.csv
hkia_flights | proxy | flight_table | https://www.hongkongairport.com/flightinfo-rest/rest/flights?date=2026-09-18&lang=en
ha_ae_waiting | browser | ae_waiting_grid | https://www.ha.org.hk/opendata/aed/aedwtdata2-tc.json
hk_public_holidays | proxy | (none) | https://www.1823.gov.hk/common/ical/en.json
hko_radar | proxy | radar_image | https://www.hko.gov.hk/wxinfo/radars/rad_256_png/2d256nradar_{YYYYMMDDHHMM}.jpg
ck_hk_hko_rss_latest_ten_minute_wind_info | proxy | wind_status | https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_wind.csv
adsb_fi_hk | proxy | (none) | https://opendata.adsb.fi/api/v2/lat/22.32/lon/114.17/dist/100
adsb_lol_hk | proxy | (none) | https://api.adsb.lol/v2/point/22.32/114.17/100
hko_rain_nowcast | proxy | rain_nowcast_map | https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast.csv
yahoo_hk_quotes | proxy | hk_market_table | https://query1.finance.yahoo.com/v8/finance/chart/%5EHSI?interval=1d&range=1d
coingecko | proxy | (none) | https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=hkd
gov_news_law_order | proxy | breaking_news_list | https://www.news.gov.hk/tc/categories/law_order/html/articlelist.rss.xml
hko_stations_network | browser | stations_status | https://portal.csdi.gov.hk/server/rest/services/common/hko_rcd_1634995599372_15888/FeatureServer/0/query?where
aqhi_city_dashboard | browser | aqhi_gauge_grid | https://dashboard.data.gov.hk/api/aqhi-individual?format=json
td_carpark_vacancy | browser | carpark_vacancy_list | https://resource.data.one.gov.hk/td/carpark/vacancy_all.json
hk_live_cams_community | n/a | live_cams_wall | data/live_streams.json
hko_tc_track | proxy | tc_track_image | https://www.weather.gov.hk/wxinfo/currwx/tc_list.xml
hko_satellite | proxy | satellite_image | https://www.hko.gov.hk/wxinfo/intersat/satellite/image/asia/202609181900+181100GLB__global_150_internet.jpg
hko_webcam | proxy | hko_cameras_wall | https://www.hko.gov.hk/wxinfo/aws/hko_mica/hko/latest_HD_HKO.jpg
td_snapshot | browser | cameras_wall | https://tdcctv.data.one.gov.hk/H109F.JPG

== panels with NO adapter (source in panels.json but not in ADAPTERS) ==
(none)

== adapters with NO panel (dead code) ==
  hk_public_holidays
  adsb_fi_hk
  adsb_lol_hk
  coingecko

== registry entries whose fetch is proxy == 104
total sources in registry: 176
```

So: **26 adapters, 22 of them wired to a panel, 4 with no user-visible surface.** Five panels also
read a *second* registry source (`td_carpark_info`, `hko_stations_network`) or a repo data file
(`data/water_suspension.json`, `data/live_streams.json`, `data/leave_plan.json`).

### 1.2 Fetch the live payload for each wired source

Proxy sources go through the deployed Worker; a browser User-Agent is mandatory (Pitfall 35).

```js
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const WORKER = "https://hk-city-monitor.cyrus738.workers.dev/proxy?url=";
const target = route === "proxy" ? WORKER + encodeURIComponent(url) : url;
const res = await fetch(target, { headers: { "User-Agent": UA, Accept: "*/*" } });
```

Raw output (abridged to the status/shape lines; full output saved at
`%TEMP%\hkcm-audit\fetch.mjs` → console):

```
### immd_cp_queue  [proxy]  HTTP 200  108ms  ct=application/json  cf=HIT  bytes=485
  JSON keys=HYW,HZM,LMC,LSC,LWS,MKT,SBC,STK    HYW = {arrQueue,depQueue}
### mtr_next_train  [direct]  HTTP 200  250ms  bytes=1028
  JSON keys=sys_time,curr_time,data,isdelay,status,message   data = {ISL-ADM}
### kmb_eta  [direct]  HTTP 200  73ms  bytes=1785
  JSON keys=type,version,generated_timestamp,data   data = array[6] of {co,route,dir,service_type,seq,dest_tc,dest_sc,dest_en,eta_seq,eta,rmk_tc,rmk_sc,rmk_en,data_timestamp}
### ha_ae_waiting  [direct]  HTTP 200  29ms  bytes=3720
  JSON keys=waitTime,updateTime   waitTime = array[18] of {hospName,t1wt,manageT1case,t2wt,manageT2case,t3p50,t3p95,t45p50,t45p95}
### aqhi_city_dashboard  [direct]  HTTP 200  39ms  bytes=1711
  JSON array n=18 item0={station,aqhi,health_risk,publish_date}
### hko_warnsum  [direct]  HTTP 200  30ms  bytes=326
  JSON keys=WHOT,WFIRE   WHOT = {name,code,actionCode,issueTime,updateTime}
### hko_warninginfo  [direct]  HTTP 200  bytes=1775   JSON keys=details   details = array[2] of {contents,warningStatementCode,updateTime}
### td_specialtrafficnews  [direct]  HTTP 200  75ms  ct=text/xml  bytes=41638   text lines=508
### gov_news_law_order  [proxy]  HTTP 200  21ms  ct=text/xml  cf=HIT  bytes=58488
### hko_rain_nowcast  [proxy]  HTTP 200  480ms  bytes=2694110   text lines=58565
### wind_10min  [proxy]  HTTP 200  49ms  cf=HIT  bytes=1304   text lines=31
### td_carpark_vacancy  [direct]  HTTP 200  52ms  bytes=120194   (leading UTF-8 BOM; res.json() handles it)
### td_carpark_info  [direct]  HTTP 200  105ms  bytes=677503
### mardep_ferry  [proxy]  HTTP 200  707ms  bytes=3450   text lines=58
### hkia_flights_registry_url  [proxy]  HTTP 200  516ms  bytes=209291   JSON array n=4
### hko_tc_track  [proxy]  HTTP 200  254ms  bytes=399
### hko_stations_network  [direct]  HTTP 200  45ms  bytes=92449   features = array[49]
### yahoo_HSI_5m  [direct]  HTTP 200  138ms  bytes=6764
### prod_water_suspension  [direct]  HTTP 200  63ms  bytes=72532
### prod_live_streams  [direct]  HTTP 200  16ms  bytes=3276
```

**Every wired source answered 200.** No 1010, no source marked dead.

### 1.3 Run the REAL parsers against the live payloads

Node 24 strips TypeScript types, so `parsers.ts` imports directly — no build, no test run
(both are forbidden for this audit), and no re-implementation of the parser under audit:

```js
const par = await import("file:///C:/hk-city-monitor/web/src/lib/parsers.ts");
const live = (f) => JSON.parse(readFileSync(`${P}/${f}.bin`, "utf8").replace(/^\uFEFF/, ""));
console.log(par.parseAeWaiting(live("ha_ae_waiting")));
```

This is the measurement the whole report rests on: **the printed values are the parser's real
output on the real payload**, not a reading of the source code.

---

## 2. Table of every wired source

| adapter id | panel | URL (registry) | HTTP | records | verdict |
|---|---|---|---|---|---|
| `immd_cp_queue` | tp_queue_grid | secure1.info.gov.hk/…/CPQueueTimeR.json | 200 | 8 stations | **OK** |
| `mtr_next_train` | mtr_next_train_list | rt.data.gov.hk/…/getSchedule.php?line=ISL&sta=ADM | 200 | 8 trains (4 UP + 4 DOWN) | **OK** (timezone-naive stamp, low) |
| `kmb_eta` | kmb_eta_table | data.etabus.gov.hk/…/stop-eta/1849…B1 (adapter overrides the registry URL) | 200 | 6 arrivals | **OK** |
| `hko_warnsum` | warnings_list | data.weather.gov.hk/…?dataType=warnsum&lang=tc | 200 | 2 warnings | **OK** (panel's `expand` param unconsumed — see 3.7) |
| `td_specialtrafficnews` | special_traffic_list | resource.data.one.gov.hk/td/tc/specialtrafficnews.xml | 200 | 17 messages | **UNIT MISMATCH** — row times are UTC |
| `wsd_water_suspension` | water_suspension_list | `data/water_suspension.json` (collector output) | 200 | 141 records / 6 active | **OK** (adapter fields all present; deployed file is 8 h old — see §3.9) |
| `mardep_crossboundary_ferry` | crossboundary_ferry_table | mardep.gov.hk/…/arrival_tc.csv | 200 | 57 rows | **OK** (source itself 135 days stale; the parser is honest about it) |
| `hkia_flights` | flight_table | hongkongairport.com/…/flights?**date=2026-09-18**&lang=en | 200 | 4 day-groups | **FIELD MISSING** — `lastUpdatedTime` null at the wired URL; date frozen |
| `ha_ae_waiting` | ae_waiting_grid | ha.org.hk/opendata/aed/aedwtdata2-tc.json | 200 | 18 hospitals | **FIELD MISSING** — `updateTime` unparseable → `observedAt: null` |
| `hko_radar` | radar_image | hko.gov.hk/…/2d256nradar_{YYYYMMDDHHMM}.jpg | 404 then 200 | 1 frame (85 KB JPEG) | **OK** (the documented guard falls through correctly) |
| `ck_hk_hko_rss_latest_ten_minute_wind_info` | wind_status | data.weather.gov.hk/…/latest_10min_wind.csv | 200 | 30 stations | **FIELD MISSING** — the direction vocabulary is not in `COMPASS` |
| `hko_rain_nowcast` | rain_nowcast_map | data.weather.gov.hk/…/Gridded_rainfall_nowcast.csv | 200 | 58 565 rows / 4 horizons | **OK** (all-zero → honest empty state) |
| `yahoo_hk_quotes` | hk_market_table | query1.finance.yahoo.com/…?interval=1d&range=1d | 200 | 1 symbol → 60 spark points | **OK** (the adapter's own `5m` URL is what runs; the registry URL would give 1 point — docs-only) |
| `gov_news_law_order` | breaking_news_list | news.gov.hk/…/articlelist.rss.xml | 200 | 20 items | **UNIT MISMATCH** — `pubDate` is date-only (00:00:00) and rows print UTC |
| `hko_stations_network` | stations_status | portal.csdi.gov.hk/…/FeatureServer/0/query… | 200 | 49 features | **OK** |
| `aqhi_city_dashboard` | aqhi_gauge_grid | dashboard.data.gov.hk/api/aqhi-individual?format=json | 200 | 18 stations | **OK** (timezone-naive `publish_date`, low) |
| `td_carpark_vacancy` (+ `td_carpark_info`) | carpark_vacancy_list | resource.data.one.gov.hk/td/carpark/vacancy_all.json + basic_info_all.json | 200 | 554 parks | **OK** — the fixed parser matches the live payload exactly |
| `hk_live_cams_community` | live_cams_wall | `data/live_streams.json` | 200 | 17 streams | **OK** |
| `hko_tc_track` (+ follow-up track XML) | tc_track_image | weather.gov.hk/wxinfo/currwx/tc_list.xml → hko_tctrack_2641.xml | 200 / 200 | 1 cyclone, 130 points | **FIELD MISSING** (cosmetic) — Chinese name is not in the track XML |
| `hko_webcam` | hko_cameras_wall (+ drawer) | hko.gov.hk/…/hko/latest_HD_HKO.jpg | 200 | 1 JPEG (387 KB) | **OK** |
| `td_snapshot` | cameras_wall (+ drawer) | tdcctv.data.one.gov.hk/H109F.JPG | 200 | 1 JPEG | **OK** |
| `hko_satellite` | satellite_image | hko.gov.hk/…/202609181900+…jpg | not fetched | — | **NOT VERIFIED** (adapter throws by design; the panel is also unreachable) |
| `hk_public_holidays` | (none) | 1823.gov.hk/common/ical/en.json | not fetched | — | **NOT APPLICABLE** (withdrawn `holiday_leave_table`) |
| `adsb_fi_hk` / `adsb_lol_hk` | (none) | adsb.fi / adsb.lol | not fetched | — | **NOT APPLICABLE** (no panel; withdrawn `aircraft_status`) |
| `coingecko` | (none) | api.coingecko.com/… | not fetched | — | **NOT APPLICABLE** (withdrawn `crypto_prices`, 429 from Cloudflare egress — documented in `panels.json`) |

---

## 3. Findings, ordered by user impact

### 3.1 HIGH — the wind parser's compass table does not contain the vocabulary the live CSV uses

**Property path:** CSV column 3 (`10-Minute Mean Wind Direction(Compass points)`) → `COMPASS[dirText]`.
**Parser line:** `web/src/lib/parsers.ts:971` — `dirDeg: COMPASS[dirText] ?? null`.

**Live evidence** (`latest_10min_wind.csv`, fetched 17:17 HKT through the Worker):

```
Date time,Automatic Weather Station,10-Minute Mean Wind Direction(Compass points),10-Minute Mean Speed(km/hour),10-Minute Maximum Gust(km/hour)
202609251700,Central Pier,East,23,32
202609251700,Chek Lap Kok,Southeast,19,27
202609251700,Cheung Chau,Southeast,27,30
202609251700,Kai Tak,Southeast,18,24
202609251700,Stanley,Northeast,N/A,N/A
202609251700,Tate's Cairn,N/A,22,30
```

The `COMPASS` table (`parsers.ts:871-876`) has full words only for the four cardinals
(`North`, `East`, `South`, `West`) and **abbreviations** for everything else (`NNE`, `NE`, `SE`…).
The feed publishes full words. Measured with the real parser:

```
dirText values that FAIL the COMPASS table: Southeast | Northeast | N/A
dirText values that HIT:                    East | North | South
stations: 30 · with a parsed direction: 11 · dropped by joinWindToStations: 18
windStatus: [{"label":"有風數據測站","value":"11/30"},{"label":"平均風速","value":"16.7 km/h"},
             {"label":"最大風速","value":"27 km/h"},{"label":"無風向讀數","value":"19"}]
joinWindToStations -> located: 10   droppedNoCoord: ["Hong Kong Sea School","North Point"]
                      droppedNoWind: ["Chek Lap Kok","Cheung Chau","Kai Tak","Lamma Island","Peng Chau",
                      "Sha Chau","Sha Tin","Stanley","Ta Kwu Ling","Tai Mei Tuk","Tai Po Kau","Tap Mun",
                      "Tate's Cairn","Tseung Kwan O","Tsing Yi","Tuen Mun","Wetland Park","Wong Chuk Hang"]
```

**What the user sees:** the 風勢 panel reports 「有風數據測站 11/30」 and 「無風向讀數 19」, and the
wind-barb layer paints **10 of 30** stations. The panel's mean speed is computed over the 11
stations that happen to have a cardinal direction: **16.7 km/h shown vs 14.6 km/h measured** over
the 29 stations that reported a speed (`windStatus()` filters `speedKmh !== null && dirDeg !== null`).
The interpolated wind field is therefore built from a third of the real stations — a partial field
that looks like thin data rather than a parser defect.

**Why the test did not catch it** (`parsers.test.ts:404-408`):

```js
const cheungChau = byName.get("Cheung Chau");
assert.equal(cheungChau!.dirDeg, 90, "East → 90°");
```

The fixture's Cheung Chau row is `202609230210,Cheung Chau,East,18,27` (asserted), the live row is
`202609251700,Cheung Chau,Southeast,27,30`. The fixture is a faithful capture; **the assertion is
the defect** — it pins the one station whose direction changed, and the summary assertion is only
`Number(noDirCell.value) >= 1`, a floor of 1 that cannot notice 19 failures out of 30.

**Fix:** add the full-word compass points to `COMPASS` (`Southeast: 135, Northeast: 45,
Northwest: 315, Southwest: 225`, plus the 12 sub-points in full-word form if HKO publishes them).
Replace the single-station assertion with a **coverage floor** on the fixture
(`stations.filter(s => s.dirDeg !== null).length >= 25`) — the fixture already carries 6 distinct
directions, so that assertion is available today.

### 3.2 HIGH — `flight_table` shows a week-old board and structurally cannot go stale

**Property paths:** `day.lastUpdatedTime` (parser) and the URL's `date=` query (registry).
**Parser line:** `web/src/lib/parsers.ts:260` — `const lu = day.lastUpdatedTime ? iso(day.lastUpdatedTime) : null;`
**Registry URL:** `sources.json` → `https://www.hongkongairport.com/flightinfo-rest/rest/flights?date=2026-09-18&lang=en` (today is 2026-09-25).

**Live evidence — the wired URL:**

```
payload dates: 2026-09-18,2026-09-18,2026-09-18,2026-09-18
lastUpdatedTime values: [null,null,null,null]
parseFlights(registry payload, 40) -> observedAt: null  rows: 40
first 3 rows: [["09-18 00:00","K4 208","CVG／NRT","At gate 23:38 (17/09/2026)"],
               ["09-18 00:00","RH 318","HAN","At gate 10:27 (19/09/2026)"],
               ["09-18 00:10","KZ 203","NRT","At gate 00:04"]]
```

**Live evidence — the same endpoint with today's date** (one query change, nothing else):

```
SAME API with date=2026-09-25: HTTP 200, array n = 9, dates 2026-09-24,2026-09-25,…
lastUpdatedTime values: ["2026-09-25T17:19:11+08:00", ×9]
parseFlights(TODAY) -> observedAt: 2026-09-25T09:19:11.000Z  rows: 40
first row: ["09-24 02:10","CX 040D","NMI","At gate 07:29 (25/09/2026)"]
```

So the frozen `date=` causes **two** failures at once: the rows are 7 days old, and
`lastUpdatedTime` is `null` on a historical date → `observedAt: null` → the panel falls back to
**fetch time** and shows a fresh 更新時間 under a `cadence_note` of 「即時」. Nothing in the UI can
degrade, because the parser has no timestamp to compare.

**Why the test did not catch it** (`parsers.test.ts:99-103`): the fixture
`web/test/fixtures/hkia_flights.json` has **2 day-groups and a real `lastUpdatedTime`**
(`2026-09-19T13:22:42+08:00`), so `assert.ok(observedAt !== null, "lastUpdatedTime parsed")` passes.
The fixture was captured when 09-18 was current — Pitfall 18 exactly: the fixture hides the fact
that the adapter's own URL now returns a different shape.

**Fix:** build the URL in the adapter from `hkToday()` (`web/src/lib/format.ts:84` — its doc comment
already names HKIA flights as the use case), and capture the fixture through the adapter's URL.
Note for the fix: the payload's day-level `arrival`/`cargo` booleans select the direction
(`true/true` = cargo arrivals, `true/false` = passenger arrivals, `false/*` = departures); the
parser reads only `origin`, so a corrected date will start mixing departure groups (which carry
`destination`, 603 records) into a column labelled 來自. The first 40 rows of today's payload are
all arrivals, so the visible symptom would come later — but the discriminator should be honoured.

### 3.3 HIGH — every list-row timestamp in 特別交通消息 and 突發新聞 is rendered in UTC (8 hours early)

**Property paths / lines:**
- `parsers.ts:93` — `time: when ? when.toISOString().slice(0, 16).replace("T", " ") : undefined` (`parseSpecialTraffic`)
- `parsers.ts:455` — the same expression in `parseRss`
- consumed at `render.ts:258-268`: a bare `YYYY-MM-DD HH:mm` is passed to `relTime()`, and
  `format.ts:72` re-parses it **as +08:00**.

**Live evidence — TD special traffic** (all 17 messages carry the same reference minute):

```
<ReferenceDate> 2026/9/25 下午 05:02:37</ReferenceDate>      (17 of 17 identical)
parseSpecialTraffic(live) -> observedAt: 2026-09-25T09:02:37.000Z   items: 17
first item time shown to user: "2026-09-25 09:02"
distinct item times: "2026-09-25 09:02"   <-- 17 rows, all 8 h earlier than reality
```

`observedAt` is the **correct** instant (17:02:37 HKT — the panel footer will print 17:02 and the
freshness chip will say just now), while every row prints `2026-09-25 09:02` and `relTime` renders it
as **「8 小時前」**. The user sees a live traffic-incident list where every incident claims to be
8 hours old, directly under a footer clock that says the data is 8 minutes old.

**Live evidence — gov news RSS:**

```
<pubDate>Thu, 24 Sep 2026 00:00:00 +0800</pubDate>
parseRss(live) -> observedAt: 2026-09-23T16:00:00.000Z   items: 20
first 3 item times: "2026-09-23 16:00" | "2026-09-23 16:00" | "2026-09-23 16:00"
raw pubDate:      Thu, 24 Sep 2026 00:00:00 +0800
```

Both the clock time **and the date** are wrong (a headline published on 09-24 is shown as 09-23).

**The in-repo correct pattern already exists:** `parseWarnsum` (line 73) slices the feed's own
offset-bearing string — `w.issueTime.slice(0, 16).replace("T", " ")` — which keeps HKT wall-clock
time and is what `relTime` expects.

**Fix:** format item times in HKT (slice the source's local string, or use an
`Intl.DateTimeFormat` with `timeZone: "Asia/Hong_Kong"` like `format.stamp()` does). Then assert an
item's exact time string in the tests.

### 3.4 HIGH — the 突發新聞 feed is permanently stale because `pubDate` is a DATE, not a timestamp

**Property path:** `<pubDate>` → `parseRssDate` → `observedAt` (`parsers.ts:444-459`).

**Live evidence** — the feed's own article id carries the real publish second:

```
first 5 objectIds (real publish stamp YYYYMMDD_HHMMSS): 20260924_215912_677 | 20260924_165150_645 | …
first 5 pubDates:                                       Thu, 24 Sep 2026 00:00:00 +0800  (×5, all midnight)
lastBuildDate: Fri, 25 Sep 2026 17:17:15 +0800          <-- the feed was rebuilt 2 min before the fetch
parseRss -> observedAt 2026-09-23T16:00:00.000Z  ->  age 41.3 h
```

`gov_news_law_order` has `cadence: "continuous"`, whose quiet tolerance is **24 h**
(`honesty.ts:137`). 41.3 h > 24 h → the panel is latched amber/red **while the feed is healthy and
the newest article is 19 hours old** (2026-09-24 21:59 HKT). The newest article is 22 hours older
than its own `pubDate` claims.

**Fix:** treat a `00:00:00` `pubDate` as date-only and derive the freshness clock from `objectId`
(which is the publisher's own `YYYYMMDD_HHMMSS`), or from `lastBuildDate` for the feed-level clock.
`parseFlights`/`parseFerry` already model "the payload's own stamp, not the fetch time" — this is the
same rule with a field that carries less precision than the parser assumes.

### 3.5 MEDIUM-HIGH — A&E waiting times: `observedAt` is `null` on every load

**Property path:** the top-level `updateTime` string.
**Parser line:** `parsers.ts:288` — `observedAt: json.updateTime ? iso(json.updateTime) : null`.

**Live evidence:**

```
raw updateTime: "2026年9月25日 下午5時00分"
new Date(that) = Invalid Date
parseAeWaiting(live) -> observedAt: null   cells: 18
```

The rows are fine (18 hospitals, `t45p50` = `"2.5 小時"`, `"4 小時"` — all present and parsed). But
the observation timestamp is discarded, so the panel's 更新時間 is the **fetch time** and the
staleness engine can never notice a frozen HA feed — a 15-minute source that has been dead for six
hours still renders as fresh and green.

**The fixture cannot catch it either:** `web/test/fixtures/ae_waiting.json` has
`"updateTime": "2026年9月19日 下午1時15分"` → the same `Invalid Date` → `observedAt: null`, and
`parsers.test.ts:108-112` asserts only `cells.length >= 15` and one level. The fixture is faithful;
**the missing assertion is the defect.**

**Fix:** add a Chinese-date parser (`YYYY年M月D日 上午/下午H時MM分` → `+08:00`) — the 上午/下午
handling already exists in `parseTdDate` (line 46) for a different format — and assert
`observedAt !== null` plus its exact value in the test.

### 3.6 MEDIUM (provable) / HIGH (if the event confirms it) — the typhoon hoist reads a warnsum field name the live payload does not use

**Property path:** `verticals.json` typhoon trigger —
`{"source":"hko_warnsum","field":"TC8","op":"exists"}` and the same for `"TC3"`.
**Engine line:** `web/src/lib/trigger.ts:41` — `getPath(state[cond.source], cond.field)`, i.e.
`state.hko_warnsum.TC8`. The warnsum adapter publishes the raw payload as `state`
(`adapters.ts:171`), so `field` must be a **key of the live payload**.

**Live payload evidence (the whole thing):**

```json
{"WHOT":{"name":"酷熱天氣警告","code":"WHOT","actionCode":"ISSUE","issueTime":"2026-09-25T11:00:00+08:00","updateTime":"2026-09-25T11:00:00+08:00"},
 "WFIRE":{"name":"火災危險警告","code":"WFIREY","type":"黃色","actionCode":"ISSUE","issueTime":"2026-09-25T06:00:00+08:00","updateTime":"2026-09-25T06:00:00+08:00"}}
```

The key is the warning **family** and the specific signal/colour rides in `code`/`type`
(`WFIRE` → `code: "WFIREY"`). By that convention a tropical-cyclone signal would be keyed
`WTCSGNL` with `code` `TC8NE`/`TC3` — **not** `TC8`. I could not obtain a TC-signal payload
(the API returns only the current state, and no signal is in force), so I am **NOT claiming this as
proven**. The probe is one line during a signal: `Object.keys(await (await fetch(warnsumUrl)).json())`.

**Provable, same root cause, lower blast radius:** `data/rules.json` has three warnsum rules using
`op: ">="` against these object-valued keys (`TC8`, `TC3`, `WRAIN`). `numericAt` returns `null` for
an object without a `.length` suffix (`rules.ts:65-81`), so `continue` (line 140) — those rules can
never fire even when the warning is in force. The analytical panel is withdrawn
(`ANALYSIS_PANEL_ENABLED = false`), so this one is a correctness-of-the-brief issue, not a UI one.

**Why no test catches it:** `trigger.test.ts:27` builds the state by hand —
`{ hko_warnsum: { TC8: { name: "八號烈風或暴風信號" } } }` — so the test proves the engine reads
`state.hko_warnsum.TC8`, not that the live payload has that key. It is the Pitfall 23/28 shape: a
hand-typed state can never disagree with the code.

**Fix:** if the probe confirms `WTCSGNL`, key the trigger on the family and check `code`
(e.g. `{field: "WTCSGNL.code", op: "in", value: ["TC8NE","TC8SE","TC8NW","TC8SW"]}`), and add a test
that reads the *captured* warnsum fixture rather than a hand-built state.

### 3.7 MEDIUM — `warnings_list` declares an expand source that no code consumes

`data/panels.json:93-95` sets `params: { "expand": "hko_warninginfo" }`, and `sources.json` carries
`hko_warninginfo` (live: `details = array[2] of {contents, warningStatementCode, updateTime}`, with
the full 酷熱天氣警告 guidance text). A grep for `expand` / `hko_warninginfo` across `web/src`
finds **no reader** — the key is read only by `scripts/validate_config.py:187`, which uses it to
count the source as *reaching the screen*. The panel therefore lists the two warnings with their
issue times and never shows the detailed statement the config promises.

**Fix:** either render `details[].contents` under the matching warning (the payload keys it with
`warningStatementCode`, which matches the warnsum key) or delete the param so the coverage count
stops crediting it.

### 3.8 MEDIUM — the TC panel drops the Chinese name that the previous call already returned

**Parser lines:** `parsers.ts:422-423` — `name: tag(xml, "TropicalCycloneChineseName") || tag(xml, "TropicalCycloneName")`.
**Live evidence:** the **track** XML's tag set is
`<TropicalCycloneTrack>,<BulletinHeader>,<BulletinName>,<BulletinType>,<BulletinProvider>,<BulletinTime>,<WeatherReport>,<TropicalCycloneName>,<PastInformation>,<Index>,<Intensity>,<MaximumWind>,<Time>,<Latitude>,<Longitude>,<AnalysisInformation>,<ForecastInformation>`
— there is **no** `TropicalCycloneChineseName` in it. The name exists only in `tc_list.xml`, which
the adapter read one call earlier:

```
parseTcList(live) -> [{"id":"2641","tcName":"舒力基","enName":"SURIGAE","trackUrl":"https://…/hko_tctrack_2641.xml"}]
parseTcTrack(live xml) -> name: "SURIGAE"  enName: "SURIGAE"  bulletinTime: 2026-09-25T08:38:14.000Z  points: 130
```

Because `name === enName`, the adapter's dedup (`adapters.ts:709`) yields `"SURIGAE"`, so a
Traditional-Chinese panel is titled 「熱帶氣旋路徑」 and shows **"SURIGAE 路徑" / "SURIGAE · 130 個定位點"**
while 舒力基 is sitting in the variable it discarded. Cosmetic, but on a life-safety panel in a
Chinese-language app, and one line to fix (pass `first.tcName` into the note/alt).

Also measured, minor: one of the 130 points has an empty `time`/`intensity`/`wind`
(`{"lat":30.42,"lon":136.4,"time":"","intensity":"","wind":"","forecast":true}`) — it is filtered
only on lat/lon being non-zero, so a heading-less point is drawn as a forecast position.

### 3.9 Observations that are NOT parser defects (stated so nobody chases them)

- **The live water-suspension file is 8 hours older than the repo's copy.** Production serves
  `generated: 2026-09-25T09:09:36+08:00` with 141 records / 6 active; the repo's
  `data/water_suspension.json` is `2026-09-25T17:19:36+08:00` with 165 records / 8 active. This is
  **not a cache** (`cache-control: public, max-age=0, must-revalidate`, and three cache-busting
  requests returned the same body) and **not a timestamp bug** (different record sets = different
  collection runs) — the deploy is simply behind the collector. Consequence: `fresh = … < 30 min`
  is false, so by design `records_fresh = []` and `drinking_now = 0`, and the 停水 auto-hoist
  **cannot fire on the live site right now** while a real 食水 現正停水 notice is in the file. Worth
  a deploy check, not a code change.
- **Radar:** the current 6-minute slot returned `HTTP 404` with **180 902 bytes of HTML** at 17:18;
  the adapter's content-type + magic-byte guard skipped it and used the 17:12 frame
  (`HTTP 200 image/jpeg, 85 014 bytes`). The guard documented at `adapters.ts:95-131` works as
  written. Not a defect — but it means every radar refresh downloads a 180 KB error page first.
- **Ferry:** the whole file is from `2026-05-13` (57 rows, distinct dates: `2026-05-13`), so the
  panel is correctly red. The parser's own-honesty rule works. Minor: `observedAt` is taken from the
  same first-`maxRows` slice that is displayed (`parsers.ts:234`), so it reported
  `2026-05-13T04:00:00Z` (12:00 HKT) while the file's newest row is `21:55` HKT — correct for "the
  newest row I show", understated for "the newest row the feed has".
- **Panel params that no code reads** (all confirmed by grep across `web/src`): `flight_table`
  `fields`; `cameras_wall` `list_source` + `prefer_grid`; `hko_cameras_wall` `list_source` + `max: 34`;
  `tc_track_image` `fallback_source`. For the walls this is user-visible in a small way:
  `ui/panels.ts:141` hardcodes `const n = isHko ? 8 : 8`, so the HKO wall draws **8 of the 34**
  available stations and the TD wall 8 of 1013; and `pickWallCameras`'s `prefer` list (written for TD
  camera names: 海底隧道, 紅磡, 青馬…) matches **1 of the 34 HKO names** (中環碼頭) and 314 of 1013 TD
  names, so the HKO wall is frozen to 中環碼頭 + the first 7 in file order.
- **`satellite_image` is unreachable:** it appears in no OVERVIEW list and no `verticals.json`
  order (union of the three verticals + OVERVIEW = 21 of 22 panels), and its adapter throws
  unconditionally (`adapters.ts:722`). A declared panel that can never render in any UI state.
- **Timezone-naive stamps** (low impact for a HK audience, wrong for anyone else):
  `parseMtrSchedule` reads `sys_time: "2026-09-25 17:17:44"` through `parseStamp`, which builds
  `new Date("2026-09-25T17:17:44")` — browser-local. On this HKT machine it printed
  `observedAt: 2026-09-25T09:17:44.000Z` (correct); in a UTC browser the same string becomes 01:17
  HKT the next day and the freshness clock is 8 h out. Same shape in `parseAqhiDashboard`
  (`publish_date: "2026-09-25T16:30:00"`, no offset). `hkToday()`/`format.stamp()` show the project
  already knows how to do this with an explicit zone.
- **MTR ignores `time` and `curr_time`:** each train carries an absolute `time`
  (`"2026-09-25 17:19:24"`); the parser uses only `ttnt`. Correct today, but the absolute stamp is
  the one that would expose a frozen `ttnt`.

---

## 4. What I did NOT verify

Named honestly, with the reason.

1. **No tropical-cyclone warnsum payload.** The typhoon trigger's `field: "TC8"`/`"TC3"`
   (§3.6) is **unproven**: the API returns only the warnings currently in force, and none today.
   I did not stand up a mock or take the repo's word for it. Probe: during a TC signal, print
   `Object.keys(warnsumPayload)` and compare with `WTCSGNL`.
2. **`hko_satellite` was not fetched at all.** The adapter throws by design (TECH_SPEC §9.2, the
   filename offset rule is unpinned) and the panel is unreachable, so there is no live URL to test.
   I did not attempt to pin the rule.
3. **Four adapters with no panel** (`hk_public_holidays`, `adsb_fi_hk`, `adsb_lol_hk`, `coingecko`)
   were not audited against live payloads — nothing renders them. `coingecko`'s 429-from-Cloudflare
   is documented in `panels.json._withdrawn_panels`; I did not re-test it.
4. **Field names and units, not value ranges.** I confirmed each path exists and produced a value;
   I did not verify that the *values* mean what the panel's label says. Specifically unchecked:
   whether TD's `vacancy` counts the same physical spaces as the label 空位 implies; whether
   `vehicle_type: "P"` is exactly "private car" for every operator; the AQHI band mapping
   (`<=3 ok / <=6 warn` in `parsers.ts:617`) against EPD's published health-risk bands (the payload
   carries its own `health_risk: "Moderate"`, which the parser ignores); the wind gust column's unit.
5. **Nothing that only appears during an event.** Beyond the TC signal: rainstorm warnings,
   the ImmD `99` sentinel at a *closed* crossing (I saw only 沙頭角 `99/99`, and only via a
   hand-built key set), and the water-suspension 鹹水-only branch (`salt_only_now`).
6. **Image walls' contents.** I verified one JPEG from each list (TD `200 image/jpeg 23 991 B`,
   HKO `200 image/jpeg 101 623 B`) and that the HKO registry URL returns `200 image/jpeg 386 983 B`.
   I did not check that all 8 tiles the wall actually picks are reachable, nor the live-stream
   YouTube probing (`probeLive`/`liveThumb`). **One of my own probes returned `400` on the camera
   wall and it was my harness bug** (I read `.src ?? .url` where the field is `img`, so it requested
   `?url=undefined`); re-probed correctly, every camera image is 200. Recorded here so the next
   reader does not chase it.
7. **Map layers.** `map/overlays.ts`, `layers.json` and the deck.gl wind field were read only where
   the panel path touched them (the wind join). I did not audit their own field reads, and deck.gl
   needs a real GPU so nothing about it is verified here.
8. **The Worker.** Its rate limit, cache behaviour and whitelist were exercised only as controls
   (non-registry host → `403 host_not_allowed`; `example.com` refused). Out of scope.
9. **No `npm test`, `npm run build`, `npm run typecheck` or server was run** (forbidden by the
   task). The parser outputs above come from importing the real modules in Node 24, not from the
   test suite.
10. **Radar is a single observation.** One 404 at 17:18 with a 200 fallback; I did not sample the
    slot over time to confirm the current slot is always unpublished at :18.

---

## 5. Parsers whose tests can only fail on a count, not a value

Every one of these has a value-level assertion available in the existing fixture and does not make it.

| test (`web/src/lib/parsers.test.ts`) | what it asserts today | what it cannot catch |
|---|---|---|
| **test 2** special traffic (§3.3) | `items.length > 0`, first title `length > 10`, `observedAt.getFullYear() === 2026` | the 8-hour UTC row-time error — no assertion on `items[0].time` at all |
| **test 5** ferry | `columns[0] === "抵達時間"`, `rows.length >= 2 && rows[0].length === 5` | `observedAt` is asserted nowhere (test 20 covers it only with a synthetic 2-row string) |
| **test 6** HKIA flights (§3.2) | `columns.length === 4`, `rows.length > 10`, `observedAt !== null` | the last assertion **is** the defect: it passes on a fixture whose shape the adapter's URL no longer returns (`lastUpdatedTime` null live) |
| **test 7** A&E (§3.5) | `cells.length >= 15`, one hospital's `level` | `observedAt`, which is `null` on the real payload *and* on the fixture — the field is read and silently discarded |
| **test 14** gov news RSS (§3.3/§3.4) | `items.length > 0`, titles `length > 5` | both the UTC row time and the date-only `pubDate`; no timestamp assertion of any kind |
| **test 24** wind (§3.1) | one station's `dirDeg === 90` and `noDirCell.value >= 1` | the direction-vocabulary gap: the fixture has 6 distinct directions and only 14/30 stations parse, but the floor is 1 |
| **test 9** nowcast | grid dimensions and `bbox` bounds | `grid.max`, which is the value that decides "render" vs the honest empty state |
| **test 8** leave plan | `rows.length > 0` | everything else (panel withdrawn, so low priority) |

Tests that are genuinely value-level and worth copying: **test 17** (carpark — re-derives the
expected numbers from the raw fixture, independently of the parser), **test 13** (sparkline
`>= 20` points), **test 20** (ferry `observedAt` equals the latest row date), **test 23** (ADS-B
seconds-vs-milliseconds), and the transport block's KMB assertion (recomputes the expected minute
from `eta − generated_timestamp`).

---

## 6. Suggested fix order

1. §3.1 `COMPASS` full-word directions (`parsers.ts:871`) — one table, restores 2/3 of the wind map.
2. §3.3 HKT row times in `parseSpecialTraffic`/`parseRss` — two expressions, removes a visible
   8-hour lie from two panels on the overview.
3. §3.2 HKIA URL from `hkToday()` + capture the fixture through the adapter's URL.
4. §3.5 Chinese `updateTime` parser for the A&E panel; §3.4 `objectId`/`lastBuildDate` for the news
   freshness clock.
5. §3.6 probe the warnsum key set during the next TC signal, then fix the trigger and add a
   fixture-driven test.
6. §3.7/§3.8 the dead `expand`/`fallback_source` params and the dropped Chinese cyclone name.
