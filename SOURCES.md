# SOURCES.md — 已實測數據源目錄

> **本檔案由 `scripts/probe_sources.py` 自動生成，唔好手改。**
> 改源 → 改 `sources.json` → 跑 `python3 scripts/probe_sources.py`。

最後實測：`2026-09-18 20:09 CST`　·　**95 / 103 個源成功**

每個 URL 都真係發過 HTTP 請求。🟢 = 200 而且回傳真數據　🟡 = 未解決／要 key　🔴 = 失敗。

## cameras

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| 運輸署 交通快拍攝影機位置 | `https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.…` | 🟢 ok | irregular | none | CSV ~1013 rows, cols: key, region, district, description, easting, northing |
| 運輸署 交通快拍圖像（單張） | `https://tdcctv.data.one.gov.hk/H109F.JPG` | 🟢 ok | 2 minutes | none | image 30826B |
| 天文台 天氣攝影機（單站 HD） | `https://www.hko.gov.hk/wxinfo/aws/hko_mica/hko/latest_HD_HKO.jpg` | 🟢 ok | 5 minutes | none | image 588539B |
| 天文台 天氣攝影機目錄頁 | `https://www.hko.gov.hk/en/wxinfo/ts/index_webcam.htm` | 🟢 ok | static | none | HTML page — title: Regional Weather in Hong Kong - Latest Weather Photo｜Hong Ko |

- **運輸署 交通快拍攝影機位置** — UTF-16LE with a DOUBLE BOM (\xff\xfe\xff\xfe) and tab-delimited. Columns: key, region, district, description, easting, northing, latitude, longitude, url. Python's utf-16 codec leaves a stray \ufeff on the first field name — strip it or every row reads empty.
- **運輸署 交通快拍圖像（單張）** — 1013 cameras. 320x240 JPEG ~30KB. May answer 301/302 — follow redirects. Key list from td_camera_list. Timestamp is burned into the image by TD.
- **天文台 天氣攝影機（單站 HD）** — 34 stations verified 200. URL pattern: wxinfo/aws/hko_mica/{lower}/{latest_HD_|latest_}{UPPER}.jpg. Station codes come from www.hko.gov.hk/en/wxinfo/ts/index_webcam.htm. HD is ~462KB, the non-HD variant ~88KB.
- **天文台 天氣攝影機目錄頁** — Source of the 34 station codes. Not machine-readable — parse once, hardcode the list.

## weather

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| 天文台 天氣警告一覽 | `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warnsum&lang=tc` | 🟢 ok | as issued | none | JSON object, keys:  |
| 天文台 詳細天氣警告資訊 | `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=warningInfo&lang=tc` | 🟢 ok | as issued | none | JSON object, keys:  |
| 天文台 本港現況（溫度、濕度、雨量、紫外線） | `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc` | 🟢 ok | 10 minutes | none | JSON object, keys: rainfall, warningMessage, icon, iconUpdateTime, uvindex, updateTime |
| 天文台 九天天氣預報 | `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc` | 🟢 ok | twice daily | none | JSON object, keys: generalSituation, weatherForecast, updateTime, seaTemp, soilTemp |
| 天文台 特別天氣提示 | `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=swt&lang=tc` | 🟢 ok | as issued | none | JSON object, keys: swt |
| 天文台 潮汐資料 | `https://data.weather.gov.hk/weatherAPI/opendata/opendata.php?dataType=HHOT&station=QUB&…` | 🟢 ok | hourly | none | JSON object, keys: fields, data |
| 天文台 環境伽馬輻射水平 | `https://data.weather.gov.hk/weatherAPI/opendata/opendata.php?dataType=RYES&station=HKO&…` | 🟢 ok | hourly | none | JSON object, keys: HKOReadingsAccumRainfall, HKOReadingsAvgRainfall, HKOReadingsMaxRH, HKOReadingsMaxTemp, HKOReadingsMinGrassTemp, HKOReadingsMinRH |
| 天文台 地震速報 | `https://data.weather.gov.hk/weatherAPI/opendata/earthquake.php?dataType=qem&lang=en` | 🟢 ok | as issued | none | JSON object, keys: lat, lon, mag, region, ptime, updateTime |
| 天文台 天氣雷達圖（256km） | `https://www.hko.gov.hk/wxinfo/radars/rad_256_png/2d256nradar_202609181924.jpg` | 🟡 ok | 6 minutes | none | image 88161B |
| 天文台 衛星雲圖 | `https://www.hko.gov.hk/wxinfo/intersat/satellite/image/asia/202609181900+181100GLB__glo…` | 🟡 ok | hourly | none | image 187827B |
| 環保署 空氣質素健康指數（各監測站，RSS） | `https://www.aqhi.gov.hk/epd/ddata/html/out/aqhi_ind_rss_Eng.xml` | 🟢 ok | hourly | none | XML, 18 <item> entries, root tags: rss, channel, title, link, image |
| 環保署 AQHI 過去 24 小時逐站讀數 | `https://www.aqhi.gov.hk/js/data/past_24_pollutant.js` | 🟢 ok | hourly | none | JavaScript data file, `station_24_data` = (strip the prefix, then JSON) |
| 環保署 AQHI 預報／健康風險級別 | `https://www.aqhi.gov.hk/js/data/forecast_aqhi.js` | 🟢 ok | daily | none | JavaScript data file, `aqhi_report` = (strip the prefix, then JSON) |
| 天文台 暑熱指數 WBGT（每 10 分鐘） | `https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/recent10_60min_wbgt.csv` | 🟢 ok | 10 minutes | none | CSV ~100 rows, cols: Date time, Automatic Weather Station, 60-minute mean Wet Bulb Globe Temperature (WBGT) |
| 天文台 格網降雨臨近預報（每 12 分鐘） | `https://data.weather.gov.hk/weatherAPI/hko_data/F3/Gridded_rainfall_nowcast.csv` | 🟢 ok | hourly | none | CSV ~58564 rows, cols: Updated Date and Time (in Hong Kong Time), Ending Date and Time (in Hong Kong Time), Latitude (degree), Longitude (degree), Half-hourly Nowcast Accumulated Rainfall (mm) |
| 天文台 智慧燈柱氣象數據（微尺度） | `https://www.hko.gov.hk/common/hko_data/smart-lamppost/files/smart_lamppost_met_device_l…` | 🟢 ok | 10 minutes | none | JSON array, 71 items |
| 天文台 熱帶氣旋路徑資訊（現行） | `https://www.weather.gov.hk/wxinfo/currwx/tc_list.xml` | 🟢 ok | as issued | none | XML, 0 <item> entries, root tags: TropicalCycloneList |
| 天文台 熱帶氣旋最佳路徑（事後分析，逐年） | `https://data.weather.gov.hk/weatherAPI/hko_data/tc/HKO2024BST.csv` | 🟢 ok | annual | none | CSV ~655 rows, cols: Tropical Cyclone Best Track Data (post analysis) |
| 環保署 AQHI（City Dashboard 版，JSON/CSV/XML） | `https://dashboard.data.gov.hk/api/aqhi-individual?format=json` | 🟢 ok | hourly | none | JSON array, 18 items |
| 天文台 香港暑熱指數（10 分鐘） | `https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/recent10_10min_hkhi.csv` | 🟢 ok | 10 minutes | none | CSV ~100 rows, cols: Date time, Automatic Weather Station, 10 minute mean Hong Kong Heat Index |
| 天文台 1 分鐘平均氣溫（分區） | `https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_1min_temperatur…` | 🟢 ok | 10 minutes | none | CSV ~39 rows, cols: Date time, Automatic Weather Station, Air Temperature(degree Celsius) |

- **天文台 天氣警告一覽** — CORS allow-origin * so the browser can fetch directly. Returns {} when no warning is in force. Otherwise keyed by warning code with name, code, actionCode, issueTime, updateTime, expireTime.
- **天文台 詳細天氣警告資訊** — Full warning text, useful for a detail drawer.
- **天文台 本港現況（溫度、濕度、雨量、紫外線）** — temperature.data[] per place, humidity, rainfall.data[] per 18 districts, uvindex, icon. recordTime/updateTime fields carry the observation time.
- **天文台 特別天氣提示** — Returns a nearly-empty body when nothing is active.
- **天文台 潮汐資料** — SOLVED: tide is HHOT (UPPERCASE) and lives on opendata.php, NOT weather.php. Needs station (QUB, CCH, ...) + year; month/day/hour optional. HLT returns astronomical high/low tides. Both verified 200 JSON.
- **天文台 環境伽馬輻射水平** — SOLVED: ambient gamma dose rate is dataType=RYES (Weather and Radiation Level Report) on opendata.php. Needs station + date (YYYYMMDD, up to yesterday). The earlier guesses rmn/radiation were wrong.
- **天文台 地震速報** — SOLVED: earthquakes live on a SEPARATE endpoint, earthquake.php — not weather.php. qem = worldwide M6+ quick report (lat/lon/mag/region/ptime); feltearthquake = locally felt tremors (returns {} when none, which is a valid empty result, not an error).
- **天文台 天氣雷達圖（256km）** — FOUND. URL is TIMESTAMPED: .../rad_256_png/2d256nradar_{YYYYMMDDHHMM}.jpg (~88KB). Images refresh every ~6 minutes, so the app must build the current timestamp (try now, then step back 6/12 minutes until a 200). The sample above was live when probed; the fixed sample will eventually 404 — that is expected, not a broken source.
- **天文台 衛星雲圖** — FOUND. Also a TIMESTAMPED path under /wxinfo/intersat/satellite/image/asia/ — the filename carries a date plus an offset token, so the exact naming rule still needs pinning. ~216KB.
- **環保署 空氣質素健康指數（各監測站，RSS）** — FOUND — the official EPD feed (data.gov.hk dataset hk-epd-airteam-current-aqhi-of-individual-air-quality-monitoring-stations). Each item's title is the station name and the description carries '<station> - <type>: <AQHI> <risk>'. ChT/ChS variants alongside. Host is www.aqhi.gov.hk — the bare aqhi.gov.hk does not resolve.
- **環保署 AQHI 過去 24 小時逐站讀數** — The file the aqhi.gov.hk page itself loads. It is JavaScript, not JSON: 'var station_24_data = [...]'. Strip the 'var ... = ' prefix then parse. Per-station hourly rows with StationID, DateTime, StationNameEN/CT/CS, aqhi and NO2/O3/SO2/CO/PM10/PM25 — i.e. the full pollutant breakdown, ~226KB.
- **環保署 AQHI 預報／健康風險級別** — 'var aqhi_report = [...]' with DateTime, StationTypeEN, AQHIRiskEN, AQHIRange. Strip the var prefix.
- **天文台 暑熱指數 WBGT（每 10 分鐘）** — 濕球黑球溫度 — 戶外工作與運動嘅真正熱壓力指標，比氣溫誠實得多。對露營、賽事、地盤、跑步都直接有用。
- **天文台 格網降雨臨近預報（每 12 分鐘）** — 格網狀未來降雨預報 —— 可以砌落雨動畫／時間軸，係整個天氣層最有動感嘅一個。另有 _tc 中文版。
- **天文台 智慧燈柱氣象數據（微尺度）** — 街頭級氣象站（智慧燈柱），比天文台站密得多。位置表 + device type 表各一個 JSON。做微尺度城市氣候／跑步路線熱壓力嘅原材料。
- **天文台 熱帶氣旋路徑資訊（現行）** — Live tropical cyclone list and track — the data behind the HKO TC track pages. Feeds the 颱風模式 vertical. Note the host is www.weather.gov.hk (not data.weather.gov.hk).
- **天文台 熱帶氣旋最佳路徑（事後分析，逐年）** — Full post-analysed track of every cyclone in a year — the honest basis for 'this storm looks like the one in 2023' comparisons, because it is the quality-controlled record rather than the forecast. Build the year into the URL and step back a year when the current one 404s.
- **環保署 AQHI（City Dashboard 版，JSON/CSV/XML）** — Cleaner than the RSS for machine use, and gives per-station current AQHI as real JSON. Hourly, plus a forecast published three times a day.
- **天文台 香港暑熱指數（10 分鐘）** — The HK Heat Index (a local apparent-temperature measure) every 10 minutes — complements WBGT. Relevant to outdoor work, sport and elderly care.
- **天文台 1 分鐘平均氣溫（分區）** — One-minute-mean temperature by station — the finest temperature resolution HKO publishes. Sibling files cover humidity, grass temperature, sea-level pressure and 10-minute wind.

## transport

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| 運輸署 行車速度圖 | `not an HTTP endpoint (websocket or still unknown)` | 🟡 unprobeable | 2 minutes | none | — |
| 運輸署 行車時間顯示器 | `not an HTTP endpoint (websocket or still unknown)` | 🟡 unprobeable | 2 minutes | none | — |
| 運輸署 特別交通消息 | `https://resource.data.one.gov.hk/td/tc/specialtrafficnews.xml` | 🟢 ok | as issued | none | XML, 0 <item> entries, root tags: body, message, msgID, CurrentStatus, ChinText |
| 行車速度圖（City Dashboard 版，JSON） | `https://static.data.gov.hk/opendata/dataset/traffic-speed/traffic-speed-info.json` | 🟢 ok | 2 minutes | none | JSON array, 6 items |
| 運輸署 實時停車場空位 | `https://resource.data.one.gov.hk/td/carpark/vacancy_all.json` | 🟢 ok | real-time | none | JSON object, keys: car_park |
| 實時空置車位（一站式整合版） | `https://api.data.gov.hk/v1/carpark-info-vacancy` | 🟢 ok | real-time | none | JSON object, keys: results |
| 城巴／新大嶼山巴士 ETA | `https://rt.data.gov.hk/v1/transport/batch/stop-eta` | 🟡 needs-params | 1 minute | none | — |
| 九巴／龍運 路線及到站時間（免 key！） | `https://data.etabus.gov.hk/v1/transport/kmb/eta/18492910339410B1/1/1` | 🟢 ok | 1 minute | none | JSON object, keys: type, version, generated_timestamp, data |
| 港鐵 下一班列車（免 key） | `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=ISL&sta=ADM` | 🟢 ok | real-time | none | JSON object, keys: sys_time, curr_time, data, isdelay, status, message |
| 龍運巴士 ETA | `https://data.etabus.gov.hk/v1/transport/lwb/route/` | 🟡 needs-params | 1 minute | none | — |
| 綠色專線小巴 ETA（1 分鐘） | `https://data.etagmb.gov.hk/route/HKI` | 🟢 ok | 1 minute | none | JSON object, keys: type, version, generated_timestamp, data |
| 新渡輪 下一班船 ETA（1 分鐘） | `https://www.sunferry.com.hk/eta/?route=CW` | 🟡 needs-params | 1 minute | none | — |
| 港九小輪 ETA／時間表／票價 | `https://www.hkkfeta.com/opendata/route/` | 🟢 ok | 1 minute | none | JSON object, keys: type, version, generated_timestamp, data |
| 運輸署 交通數據分析系統（5 分鐘） | `https://tdas-api.hkemobility.gov.hk/tdas/api/route -> HTTP 403` | 🔴 fail | 5 minutes | none | — |

- **運輸署 行車速度圖** — REAL PATHS NOT FOUND: resource.data.one.gov.hk/td/speedmap.xml returns 404 (the 404 body is a decoy PHP index that lists paths which do not exist). Use td_traffic_speed_city (JSON) instead; for XML find the current TIS path on data.gov.hk.
- **運輸署 行車時間顯示器** — REAL PATH NOT FOUND: resource.data.one.gov.hk/td/journeytime.xml returns 404. See the City Dashboard journey-time dataset on data.gov.hk.
- **運輸署 特別交通消息** — Also available in en and sc. Good event-feed source for the map.
- **行車速度圖（City Dashboard 版，JSON）** — JSON twin of the TIS XML — much easier for a static front end.
- **運輸署 實時停車場空位** — Real-time vacancy counts. The JSON body starts with a UTF-8 BOM — decode as utf-8-sig or json.loads throws. Key: car_park[].
- **實時空置車位（一站式整合版）** — Merges TD and Kai Tak (start-up Kowloon East) car park feeds.
- **城巴／新大嶼山巴士 ETA** — Batch endpoint — a GET returns 422, it needs a POST body of stop ids. Also has per-route ETA endpoints under rt.data.gov.hk.
- **九巴／龍運 路線及到站時間（免 key！）** — NO KEY NEEDED — data.etabus.gov.hk is KMB's own open data portal. Verified: /route/ lists all routes (~349KB); /route-stop/{route}/{direction}/{service_type} for the stop sequence; /eta/{stop_id}/{route}/{service_type} for arrivals. GOTCHA: direction must be the literal 'outbound' or 'inbound' — O/I/1/2 all return 422 'Invalid direction'.
- **港鐵 下一班列車（免 key）** — Keyless mirror on rt.data.gov.hk — the official opendata.mtr.com.hk Next Train API instead wants a free registration. line=ISL / sta=ADM returns UP and DOWN trains with platform and ttnt.
- **龍運巴士 ETA** — Service is live (it answers structured 422 JSON) but the parameter format differs from KMB and is unconfirmed. Cheap to finish — try the KMB path shapes with the lwb prefix.
- **綠色專線小巴 ETA（1 分鐘）** — Green minibus real-time arrivals, keyless. Paths use region codes and the dataset lists the full set of templates (/route/{region}, /route-stop/{route_id}/{route_seq}, /stop-route/{stop_id}, /eta/route-stop/{route_id}/{route_seq}/{stop_seq}).
- **新渡輪 下一班船 ETA（1 分鐘）** — Sun Ferry estimated arrivals, refreshed every minute. The route code goes in the query string — confirm the valid codes from their site before wiring it.
- **港九小輪 ETA／時間表／票價** — Hong Kong & Kowloon Ferry open data: piers, routes, timetables, fares and ETA. One operator quietly publishing a clean JSON API — worth supporting by using it.
- **運輸署 交通數據分析系統（5 分鐘）** — 403 on every attempt — including with Referer and Origin headers set to hk eMobility, so it is not a simple hotlink guard: the endpoint is likely keyed or IP-restricted. Left in the catalogue as a known-gated source rather than deleted, because it is the live road-speed API behind 香港出行易. We already have TD's speed map and journey time feeds, so nothing is blocked by this.

## border

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| 保安局「口岸通」陸路管制站情況 | `https://www.sb.gov.hk/chi/bwt/status.html?type=outbound` | 🟢 ok | 15 minutes | none | HTML page — title: 口岸通 |
| 香港出行易 管制站狀況 | `https://www.hkemobility.gov.hk/tc/control-point` | 🟡 ok | 15 minutes | none | HTML page — title: HKeMobility |
| 入境處 13 個出入境管制站＋開放時間 | `https://www.immd.gov.hk/hkt/contactus/control_points.html` | 🟢 ok | static | none | HTML page — title: 出入境管制站地點 | 入境事務處 |
| 保安局「口岸通」陸路管制站即時狀況（JSON） | `https://www.sb.gov.hk/bwt/json/overview_tc.json` | 🟢 ok | 15 minutes | none | JSON object, keys: updateDate, cpInfoList, otherInfo, remark |
| 入境處 陸路管制站輪候時間（官方 15 分鐘） | `https://secure1.info.gov.hk/immd/mobileapps/2bb9ae17/data/CPQueueTimeR.json` | 🟢 ok | 15 minutes | none | JSON object, keys: HYW, HZM, LMC, LSC, LWS, MKT |

- **保安局「口岸通」陸路管制站情況** — The human page. The machine-readable data is sb_bwt_json (/bwt/json/overview_tc.json) — use that; do not parse this HTML.
- **香港出行易 管制站狀況** — Page is a ~3.5KB JS app. Find its data endpoint. Covers passenger and private-car channels.
- **入境處 13 個出入境管制站＋開放時間** — Static list of 13 control points with opening hours. Hardcode once — lets the UI show 現正開放／已關閉 without any live source.
- **保安局「口岸通」陸路管制站即時狀況（JSON）** — SOLVED — this is the JSON behind 口岸通, and it is the highest-value source in the project. updateDate + cpInfoList[]; each control point has code, cpName, openFrom/openTo and arrival/departure, each broken down into resident / visitor / car / cross-border shuttle, with status 1/2/3 for the green-yellow-red level. Keyless. NOTE: there is no Chinese in the path — /bwt/json/overview_tc.json sits directly under www.sb.gov.hk.
- **入境處 陸路管制站輪候時間（官方 15 分鐘）** — THE OFFICIAL control-point waiting time feed from Immigration — 15-minute cadence, no key. This is better than reading 口岸通's page: 口岸通 gives a green/yellow/red band, this gives the actual queue time. Keep 口岸通 too — it adds the incident notices and the cross-boundary shuttle waits. Found only by the full CKAN scan; a keyword search misses it. Verified response keys are the control-point codes themselves: HYW, HZM, LMC, LSC, LWS, MKT.

## aviation

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| adsb.lol 香港範圍航班（社群 ADS-B） | `https://api.adsb.lol/v2/point/22.32/114.17/100` | 🟢 ok | ~10 seconds | none | JSON object, keys: ac, msg, now, total, ctime, ptime |
| OpenSky Network 香港 bbox | `https://opensky-network.org/api/states/all?lamin=22.10&lomin=113.80&lamax=22.60&lomax=1…` | 🟢 ok | ~10 seconds | register | JSON object, keys: time, states |
| 香港國際機場 航班（免 key） | `https://www.hongkongairport.com/flightinfo-rest/rest/flights?date=2026-09-18&lang=en` | 🟢 ok | real-time | none | JSON array, 9 items |
| adsb.fi 香港範圍航班（第二個免 key 鏡） | `https://opendata.adsb.fi/api/v2/lat/22.32/lon/114.17/dist/100` | 🟢 ok | ~10 seconds | none | JSON object, keys: now, aircraft, resultCount, ptime |
| adsbdb 飛機註冊／機型補充資料 | `https://api.adsbdb.com/v0/callsign/CPA255` | 🟢 ok | static | none | JSON object, keys: response |
| airplanes.live（403，唔用） | `https://api.airplanes.live/v2/point/22.32/114.17/100 -> HTTP 403` | 🔴 fail | ~10 seconds | register | — |

- **adsb.lol 香港範圍航班（社群 ADS-B）** — NO KEY, NO REGISTRATION, and the best of the free ADS-B mirrors: verified 52 aircraft on the HK 100nm circle. Path is /v2/point/{lat}/{lon}/{radius_nm}. Use this as the primary flights layer.
- **OpenSky Network 香港 bbox** — Verified 26 aircraft in the HK bbox anonymously. Rate-limited without an account, so it is the fallback mirror rather than the primary. Free account raises the limit.
- **香港國際機場 航班（免 key）** — The public keyless feed hongkongairport.com itself uses (the official AAHK Data Services API wants a free developer account). Add arrival=true&cargo=false to filter. /rest/flights/past also works; /rest/flights/search is 404. ~210KB per request — fetch it server-side and slim it, not per client.
- **adsb.fi 香港範圍航班（第二個免 key 鏡）** — VERIFIED — 42 aircraft, keyless. Note the path shape differs from adsb.lol: /v2/lat/{lat}/lon/{lon}/dist/{nm}. Having two independent keyless mirrors means the flights layer survives one of them going down; interleave them rather than picking one.
- **adsbdb 飛機註冊／機型補充資料** — VERIFIED keyless enrichment: callsign to airline/route, and /v0/aircraft/{hex} for registration, type, owner and photo. Cheap way to turn a bare hex+callsign on the map into something a reader understands. Cache it — this data barely changes.
- **airplanes.live（403，唔用）** — Returns 403 without credentials. Listed so nobody re-tries it; adsb.lol and adsb.fi cover the need.

## marine

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| AISStream 船隻 AIS（WebSocket） | `not an HTTP endpoint (websocket or still unknown)` | 🟡 unprobeable | real-time | free-key | — |
| 海事處 跨境渡輪到港／離港（5 分鐘） | `https://www.mardep.gov.hk/e_files/hk/opendata/arrival_tc.csv` | 🟢 ok | 5 minutes | none | CSV ~57 rows, cols: 抵達時間|出發地|營運公司|碼頭|泊位|現況 |
| 海事處 船隻抵港／離港（20 分鐘） | `https://www.mardep.gov.hk/e_files/en/opendata/RN0010.XML` | 🟢 ok | 15 minutes | none | XML, 0 <item> entries, root tags: RN0010, G_SQL1, VESSEL_NAME, SHIP_TYPE_DESC, LIC_MD_REF |

- **AISStream 船隻 AIS（WebSocket）** — THE ONLY genuinely free live AIS feed — global terrestrial receivers, free API key, WebSocket with a bounding-box subscription. Three things to be honest about: (1) it is terrestrial, so vessels roughly 40nm offshore vanish; (2) the vendor's own coverage notes are strongest in European/Atlantic waters and weakest in Asia, which is exactly where HK is — so HK coverage is UNPROVEN, not assumed; (3) it cannot run from a static page, it needs a persistent VPS collector. Measure before building: python3 scripts/test_ais_coverage.py --minutes 10. Dark ships (AIS switched off) need paid satellite AIS and are out of scope. Fallback if that measurement says NO-GO: a free-tier keyed REST AIS provider (VesselAPI and similar) is the next step, but do not add one to this catalogue until a real endpoint has been requested and returns data — vendor marketing pages are not sources.
- **海事處 跨境渡輪到港／離港（5 分鐘）** — Cross-boundary ferry arrivals and departures, 5-minute cadence. Together with the ImmD queue time this completes the 'cross the border by any mode' picture.
- **海事處 船隻抵港／離港（20 分鐘）** — Ocean and river vessel arrivals/departures. Also declared missing earlier and found by the full scan — the lesson repeats: a keyword search is not evidence of absence.

## civic

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| 康文署 康體活動節目（未來約 1.5 個月） | `https://www.lcsd.gov.hk/datagovhk/event/leisure_prog.json` | 🟢 ok | daily | none | JSON array, 629 items |
| 康文署 康體設施使用率（年度） | `https://www.lcsd.gov.hk/datagovhk/facility/lcsd_Activity_Room_tc.csv` | 🟢 ok | annual | none | CSV ~262 rows, cols: 年份, 設施, 場地, 使用率, 地區, 備註 |
| 漁護署 郊野公園封閉山徑 | `https://portal.csdi.gov.hk/server/rest/services/common/afcd_rcd_1742550096880_1424/Feat…` | 🟢 ok | on update | none | JSON object, keys: type, features |
| 香港公眾假期 | `https://www.1823.gov.hk/common/ical/en.json` | 🟢 ok | annual | none | JSON object, keys: vcalendar |
| 康文署 SmartPLAY 康體活動（現行，取代舊 leisure_prog） | `https://data.smartplay.lcsd.gov.hk/rest/cms/api/v1/publ/contents/open-data/activity-pro…` | 🟢 ok | continuous | none | large json response, truncated at the 4MB probe cap — reachable, payload not parsed |
| 康文署 文化／演藝節目 | `https://www.lcsd.gov.hk/datagovhk/event/events.xml` | 🟢 ok | continuous | none | XML, 0 <item> entries, root tags: events, event, titlec, titlee, cat1 |
| 康文署 節目日期 | `https://www.lcsd.gov.hk/datagovhk/event/eventDates.xml` | 🟢 ok | continuous | none | XML, 0 <item> entries, root tags: event_dates, event, indate |
| 康文署 節目場地（含經緯度） | `https://www.lcsd.gov.hk/datagovhk/event/venues.xml` | 🟢 ok | continuous | none | XML, 0 <item> entries, root tags: venues, venue, venuec, venuee, latitude |
| 康文署 場地總表（開放時間、休息日、地址） | `https://www.lcsd.gov.hk/datagovhk/venue/venue.json` | 🟢 ok | periodic | none | JSON array, 629 items |
| URBTIX 售票節目（每日批次） | `https://fs-open-1304240968.cos.ap-hongkong.myqcloud.com/prod/gprd/URBTIX_eventBatch_202…` | 🟢 ok | daily | none | XML, 0 <item> entries, root tags: BATCH, SEND_DATE, SYSTEM, TOTAL, EVENTS |
| 康文署 體育館（CSDI） | `https://portal.csdi.gov.hk/server/rest/services/common/lcsd_rcd_1629267205215_31341/Fea…` | 🟢 ok | snapshot | none | JSON object, keys: type, features |
| 康文署 網球場（CSDI） | `https://portal.csdi.gov.hk/server/rest/services/common/lcsd_rcd_1629267205215_84141/Fea…` | 🟢 ok | snapshot | none | JSON object, keys: type, features |
| 康文署 羽毛球場（CSDI） | `https://portal.csdi.gov.hk/server/rest/services/common/lcsd_rcd_1629267205214_38344/Fea…` | 🟢 ok | snapshot | none | JSON object, keys: type, features |
| 康文署 籃球場（CSDI） | `https://portal.csdi.gov.hk/server/rest/services/common/lcsd_rcd_1629267205215_38105/Fea…` | 🟢 ok | snapshot | none | JSON object, keys: type, features |
| 康文署 圖書館（CSDI） | `https://portal.csdi.gov.hk/server/rest/services/common/lcsd_rcd_1629267205214_44807/Fea…` | 🟢 ok | snapshot | none | JSON object, keys: type, features |
| 康文署 博物館（CSDI） | `https://portal.csdi.gov.hk/server/rest/services/common/lcsd_rcd_1629267205214_78787/Fea…` | 🟢 ok | snapshot | none | JSON object, keys: type, features |
| 康文署 公園、動物園及花園（CSDI） | `https://portal.csdi.gov.hk/server/rest/services/common/lcsd_rcd_1629267205215_19292/Fea…` | 🟢 ok | snapshot | none | JSON object, keys: type, features |
| 康文署 渡假營（CSDI） | `https://portal.csdi.gov.hk/server/rest/services/common/lcsd_rcd_1629267205214_83172/Fea…` | 🟢 ok | snapshot | none | JSON object, keys: type, features |
| 康文署 燒烤場（CSDI） | `https://portal.csdi.gov.hk/server/rest/services/common/lcsd_rcd_1634540957025_61259/Fea…` | 🟢 ok | snapshot | none | JSON object, keys: type, features |
| 漁護署 郊野公園封閉設施 | `https://portal.csdi.gov.hk/server/rest/services/common/afcd_rcd_1728897009646_22480/Fea…` | 🟢 ok | live | none | JSON object, keys: type, features |
| 統計處 人口增長（表 110-01003，半年更新） | `https://www.censtatd.gov.hk/tc/web_table.html?id=110-01003&full_series=1&download_excel=1` | 🟢 ok | half-yearly | none | HTML page — title: 統計表 |
| 2021 人口普查（最新已公佈） | `https://www.censtatd.gov.hk/tc/scode500.html` | 🟡 ok | decennial | none | HTML page — title: 住戶 |
| 天文台 公曆↔農曆對照（通勝／擇日基礎） | `https://data.weather.gov.hk/weatherAPI/opendata/lunardate.php?date=2026-02-17` | 🟢 ok | yearly | none | JSON object, keys: LunarYear, LunarDate |
| 天文台 日出／日中／日落時間 | `https://data.weather.gov.hk/weatherAPI/opendata/opendata.php?dataType=SRS&year=2026&rfo…` | 🟢 ok | yearly | none | CSV ~365 rows, cols: YYYY-MM-DD, RISE, TRAN., SET |
| 醫管局 急症室輪候時間（15 分鐘） | `https://www.ha.org.hk/opendata/aed/aedwtdata2-tc.json` | 🟢 ok | 15 minutes | none | JSON object, keys: waitTime, updateTime |
| 水務署 臨時停水通知（5 分鐘） | `https://www.esd.wsd.gov.hk/wsms_open_data/WSMS_OPEN_DATA(all).csv` | 🟢 ok | 5 minutes | none | CSV ~190 rows, cols: SUSPENSION_ID|WATER_TYPE_DESCRIPTION|WATER_TYPE_DESCRIPTION_ZHT|DISTRICT_ENG|DISTRICT_ZHT|NATURE_DESCRIPTION|NATURE_DESCRIPTION_ZHT|SUSPENSION_DATE_TIME|ACTUAL_RESUMPTION_DATE_TIME|LONG_ADDRESS|LONG_ADDRESS_ZHT|CAUSE|CAUSE_ZHT|STATUS|STATUS_ZHT |
| 康文署 即時可訂場節數（羽毛球／籃球／網球／草地足球／排球） | `https://data.smartplay.lcsd.gov.hk/rest/cms/api/v1/publ/contents/open-data/badminton/file` | 🟢 ok | 5 minutes | none | large json response, truncated at the 4MB probe cap — reachable, payload not parsed |
| 消防處 自動體外心臟去顫器（AED）位置（實時） | `https://es.hkfsd.gov.hk/aed_api/export_aed.php?lang=TC` | 🟢 ok | real-time | none | CSV ~4624 rows, cols: AED Name, AED Address, Detailed location of the AED installed, Location Google Map coordinate: latitude, Location Google Map coordinate: longitude, Whether the AED can be used by anyone |

- **康文署 康體活動節目（未來約 1.5 個月）** — This is the 'what's on soon' feed. Note the http (not https) scheme. Try the https variant too and prefer it if it works.
- **康文署 康體設施使用率（年度）** — Annual statistics only — NOT live booking availability. Do not present as real-time.
- **漁護署 郊野公園封閉山徑** — Live closure layer (7 features, all 'Temporary closed'). Fields TRAIL_ID, TRAIL_NAME_EN/TC, LOCATION_EN/TC, STATUS_EN/TC, EFFECTIVE_DATE, EXPECTED_EXPIRY_DATE. Good hiking-safety layer; also reachable via the CSDI file-api form.
- **香港公眾假期** — VERIFIED. Covers 2025-01 to 2027-12, 17 general holidays in 2026. The JSON body has a UTF-8 BOM — decode utf-8-sig. Also a valid RFC5545 .ics. This is 1823 (the government contact centre) publishing the official holiday calendar.
- **康文署 SmartPLAY 康體活動（現行，取代舊 leisure_prog）** — THE current 'what's on soon' feed — ~8,700 records with ~7,200 upcoming. ~17MB, so fetch it on a schedule from the VPS and slim it to a static JSON; never ship 17MB to the browser. Fields include ACTIVITY_NO, EN_PGM_NAME, PGM_START/END_DATE, EN_VENUE, FEE, QUOTA, PLACES_LEFT. This supersedes lcsd_leisure_prog, which is frozen and stale.
- **康文署 文化／演藝節目** — Current cultural programme listings, ~1.9MB. <events> with id, titlec/titlee, cat1/cat2, predateC.
- **康文署 節目日期** — Maps event id to performance dates (<indate>). Join with events.xml and venues.xml.
- **康文署 節目場地（含經緯度）** — Venue id, name, latitude/longitude — enough to put cultural events on the map.
- **康文署 場地總表（開放時間、休息日、地址）** — 629 venues across 15 categories. Has OpeningHour_en/cn AND ClosedOn_en/cn AND PublicHolidayOpeningHour — this is how the UI answers '邊個場今日開唔開' without any live source. A temporary-closure feed does NOT exist (checked); holiday.xml returns an empty <holiday/>.
- **URBTIX 售票節目（每日批次）** — The URL embeds the publish date as YYYYMMDD — substitute today's date (a future date 404s). ~550KB, <BATCH><TOTAL><EVENTS> with ST_DATE/ED_DATE, EVENT_CODE, name, REFERENCE_LINK, CATEGORY.
- **康文署 體育館（CSDI）** — Layer 'SC'. Dataset id lcsd_rcd_1629267205215_31341.
- **康文署 網球場（CSDI）** — Layer 'geotagging'. Dataset id lcsd_rcd_1629267205215_84141.
- **康文署 羽毛球場（CSDI）** — Layer 'geodatastore'. Dataset id lcsd_rcd_1629267205214_38344.
- **康文署 籃球場（CSDI）** — Layer 'geodatastore'. Dataset id lcsd_rcd_1629267205215_38105.
- **康文署 圖書館（CSDI）** — Layer 'LIBRARY'. Dataset id lcsd_rcd_1629267205214_44807.
- **康文署 博物館（CSDI）** — Layer 'MUSEUM'. Dataset id lcsd_rcd_1629267205214_78787.
- **康文署 公園、動物園及花園（CSDI）** — Layer 'PARKS'. Dataset id lcsd_rcd_1629267205215_19292.
- **康文署 渡假營（CSDI）** — Layer 'HC'. Dataset id lcsd_rcd_1629267205214_83172.
- **康文署 燒烤場（CSDI）** — Layer 'LCSD_BBQ'. Dataset id lcsd_rcd_1634540957025_61259.
- **漁護署 郊野公園封閉設施** — Live closure layer. FAC_ID, FACILITY_TYPE_EN/TC, LOCATION_EN/TC, STATUS_EN/TC, EFFECTIVE_DATE (epoch ms), EXPECTED_EXPIRY_DATE.
- **統計處 人口增長（表 110-01003，半年更新）** — Any 統計處 table downloads as XLSX through this query-string form — swap the id. Half-yearly for population. Related ids worth wiring: 110-01001 (population by sex and age), 130-06102 (domestic households).
- **2021 人口普查（最新已公佈）** — IMPORTANT for expectations: the 2021 census is the newest published census. The 2026 POPULATION CENSUS is being collected during calendar 2026 (by order published in the Gazette on 2025-02-14, one in ten households sampled), so its results are NOT available yet — plan the census layer around 2021 plus the rolling half-yearly statistics tables, and add 2026 when it lands. Dataset subject pages host the tables as XLSX.
- **天文台 公曆↔農曆對照（通勝／擇日基礎）** — 喂 date=YYYY-MM-DD，回農曆日期（年月日、干支、生肖）。年度 CSV 全表：hko_data/calendar/nongli_calendar_2023.csv。呢個就係所有農曆功能嘅官方地基 —— 農曆新年、清明、中秋、初一十五、擇日，全部由佢計，唔使自己寫曆法。
- **天文台 日出／日中／日落時間** — 全年逐日日出日落。三種人會用：影相嘅（黃金時間）、跑山嘅（幾點天黑）、風水／座向參考。同一個 opendata.php 仲有月出月落。
- **醫管局 急症室輪候時間（15 分鐘）** — Accident & Emergency waiting time per public hospital, updated every 15 minutes, keyless. Genuinely useful to a resident and rarely seen in dashboards — this is the kind of source that makes a monitor worth opening.
- **水務署 臨時停水通知（5 分鐘）** — Temporary water suspension notices, every 5 minutes. Directly answers 'why is my water off' — pair with a map of the affected address. Reaches us only after relaxing the TLS cipher security level — if a future client gets a handshake failure here, that is the cause, not the dataset.
- **康文署 即時可訂場節數（羽毛球／籃球／網球／草地足球／排球）** — !! I PREVIOUSLY DECLARED THIS DID NOT EXIST, AND I WAS WRONG. LCSD publishes the live availability of bookable sessions per venue every 5 minutes, keyless, for badminton / basketball / tennis / turf soccer / volleyball. So the honest answer to 'can we show 訂場情況' is yes — with real vacancy, not a workaround. Every court type is the same path with a different sport segment.
- **消防處 自動體外心臟去顫器（AED）位置（實時）** — Every public AED location with coordinates, keyless. A map layer that could genuinely save a life, and a good example of a layer that earns its place on a dashboard. Verified: 4,624 AED records with latitude/longitude and a usable-by-anyone flag.

## prices

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| 消委會 油價資訊通（車用燃油價格） | `https://oil-price.consumer.org.hk/tc/today-discount` | 🟡 ok | daily | none | HTML page — title: 今日折扣及優惠 - 消費者委員會油價資訊通 |
| 消委會 網上價格一覽通（超市格價） | `https://online-price-watch.consumer.org.hk/opw/list/001/001/001` | 🟡 ok | weekly | none | HTML page — title: 搜尋貨品 |
| 消委會 嬰幼兒奶粉價格調查 | `https://www.consumer.org.hk/tc/price-comparison-tools/infant-formula-price-survey` | 🟡 ok | monthly | none | HTML page — title: 嬰幼兒配方奶粉價格調查 | 消費者委員會 |
| 消委會 投訴統計 | `https://data.gov.hk/tc-data/dataset/cc-complaints-complaints-statistics` | 🟡 ok | monthly | none | CSV ~1811 rows, cols:  |
| 運輸署 公共交通路線及收費（巴士/小巴/渡輪/電車） | `https://static.data.gov.hk/td/routes-and-fares/FARE_BUS.csv` | 🟡 ok | daily | none | CSV ~42 rows, cols: ROUTE_ID, ROUTE_SEQ, CHANGE |
| 差餉物業估價署 物業市場統計（官方樓價／租金指數） | `https://www.rvd.gov.hk/datagovhk/1.1A(86-98).csv` | 🟢 ok | monthly | none | CSV ~14 rows, cols: PRIVATE  DOMESTIC  -  AVERAGE  RENTS  BY  CLASS [ANNUAL[86-98]], , , , ,  |
| 土地註冊處 每月註冊契約統計（實際成交量） | `https://www.landreg.gov.hk/datagovhk/202101_data.json` | 🟢 ok | monthly | none | JSON array, 44 items |
| 中原城市指數 CCL／CRI（私人，冇公開 API） | `https://hk.centanet.com/info/property-news/` | 🟡 ok | weekly | none | HTML page — title: 地產新聞資訊 | 中原地產 |

- **消委會 油價資訊通（車用燃油價格）** — Every oil company's retail price AND after-discount price per station, plus weekly offers. NO official API — it is a server-rendered Typo3 site (plain GET, stable paths such as /tc/price, /tc/station, /tc/today-discount), so it is scrapeable without a browser, but it is still scraping. A third party (talklivelihood.hk) already republishes it. BEST MOVE: ask the Consumer Council for a feed — a public body publishing a consumer tool should be able to publish data. No price data on data.gov.hk (only complaints statistics).
- **消委會 網上價格一覽通（超市格價）** — Supermarket prices across the major chains (惠康, 百佳, Market Place, AEON, 大昌, city'super...) for hundreds of product categories. Hierarchical server-rendered URLs (/opw/list/{cat}/{sub}/{subsub}) but the product pages carry NO prices in the HTML — prices arrive via an AJAX call that still needs reversing. Higher effort and higher fragility than the fuel tool. Prefer asking for a feed.
- **消委會 嬰幼兒奶粉價格調查** — Part of the Consumer Council price-comparison toolkit. Check whether the survey is published as a table or a PDF.
- **消委會 投訴統計** — The ONLY Consumer Council dataset on data.gov.hk. Resolve the real CSV resource URL via the CKAN API.
- **運輸署 公共交通路線及收費（巴士/小巴/渡輪/電車）** — GOTCHA: the CSVs are DAILY CHANGE LOGS only (ROUTE_ID, ROUTE_SEQ, CHANGE = ADD/DELETE/UPDATE) — they contain NO fares. The real fare tables are MS Access files, e.g. FARE_BUS.mdb at 32.9 MB. Full family available: ROUTE_/RSTOP_/STOP_/FARE_ x BUS, GMB (minibus), FERRY, TRAM, PTRAM. To use it: convert the .mdb to SQLite/Parquet once with mdbtools, then apply the daily deltas. A one-off converter is a genuinely useful open-source contribution and the only free source of complete HK public-transport fares.
- **差餉物業估價署 物業市場統計（官方樓價／租金指數）** — The OFFICIAL property price and rental index series — the public-sector counterpart to 中原 CCL/CRI. Monthly for the headline series; completions, stock, vacancy and take-up are annual. Filenames are historical table numbers, e.g. 1.1A(86-98).csv, 1.1Q(82-98).csv — list the directory rather than guessing a filename.
- **土地註冊處 每月註冊契約統計（實際成交量）** — Actual transaction volume by instrument type — the ground truth behind any price index. A JSON twin exists for every month (YYYYMM_data.json / .xls), so build the URL from the current month and fall back one month. Monthly.
- **中原城市指數 CCL／CRI（私人，冇公開 API）** — Be clear about what this is: 中原 CCL/CRI is a PRIVATE product of 中原地產, not open data. It is published as weekly (CCL) and monthly (CRI) press releases and republished by third parties. No public API exists and the licence is theirs. Options, in order of preference: (1) use the official 差餉物業估價署 index instead — it is free, monthly and unambiguous; (2) if the CCL number matters for narrative, cite it with a link and never present it as our own data; (3) only consider scraping the research page if the citation route proves insufficient.

## news

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| 政府新聞公報 RSS（全部） | `https://www.info.gov.hk/gia/rss/general_zh.xml` | 🟢 ok | as issued | none | XML, 100 <item> entries, root tags: rss, channel, title, link, image |
| 消防處 新聞公報 | `https://www.hkfsd.gov.hk/chi/fsd_info/publications/pressrelease/` | 🟡 ok | as issued | none | HTML page — title: 新聞公報 | 香港消防處 |
| 政府新聞網 治安（法治）分類 feed | `https://www.news.gov.hk/tc/categories/law_order/html/articlelist.rss.xml` | 🟢 ok | continuous | none | XML, 20 <item> entries, root tags: rss, channel, title, link, image |
| 政府統計處 新聞稿 RSS | `https://www.censtatd.gov.hk/data/tc/press_release/rss.xml` | 🟢 ok | continuous | none | XML, 10 <item> entries, root tags: rss, channel, title, image, url |

- **政府新聞公報 RSS（全部）** — VERIFIED valid RSS 2.0, ~478KB, ~100 items. NOTE: general.xml (no suffix) is 404. Publish TITLE + LINK ONLY — never republish article bodies.
- **消防處 新聞公報** — Find an RSS/JSON form of this list if one exists.
- **政府新聞網 治安（法治）分類 feed** — The 治安 topic feed. Other topics follow the same pattern: admin, finance, environment, health, infrastructure, school_work, city_life. Title + link only in our UI.
- **政府統計處 新聞稿 RSS** — The '統計處資料 update 一下' problem, solved: every statistical release lands here first, with the publication calendar behind it.

## market

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| Yahoo Finance 恒生指數 | `https://query1.finance.yahoo.com/v8/finance/chart/%5EHSI?interval=1d&range=1d` | 🟢 ok | delayed | none | JSON object, keys: chart |
| CoinGecko 加密貨幣 | `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=hkd` | 🟢 ok | 1 minute | none | JSON object, keys: bitcoin, ethereum |

- **Yahoo Finance 恒生指數** — NO CORS header — must be proxied server side (nginx proxy_pass, 3 lines). Verified working: ^HSI 24750.78 HKD, ^HSCE, 0700.HK, 9988.HK, 3690.HK, 1810.HK, 0005.HK, 0388.HK, 1299.HK, 0939.HK also work. DELAYED — must be labelled 延遲報價 in the UI.
- **CoinGecko 加密貨幣** — Free tier is rate-limited but keyless.

## geospatial

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| CARTO dark-matter 底圖 style | `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json` | 🟢 ok | static | none | JSON object, keys: version, name, metadata, sources, sprite, glyphs |
| CSDI 空間數據共享平台 API | `https://portal.csdi.gov.hk/csdi-webpage/file-api?dataset_id=lcsd_rcd_1634540558875_7743…` | 🟢 ok | varies | none | JSON object, keys: type, name, features |
| 地政總署 地址搜尋（ALS / Location Search API） | `https://www.als.gov.hk/lookup?q=30%20Luen%20Wan%20Street` | 🟢 ok | monthly | none | JSON object, keys: RequestAddress, SuggestedAddress |
| 地政總署 Location Search API（GeoInfo Map） | `https://www.map.gov.hk/gs/api/v1.0.0/locationSearch?q=cultural%20centre` | 🟢 ok | real-time | none | JSON array, 27 items |
| 天文台 氣象站網絡（含座標，CSDI） | `https://portal.csdi.gov.hk/server/rest/services/common/hko_rcd_1634995599372_15888/Feat…` | 🟡 ok | snapshot | none | JSON object, keys: type, features |

- **CARTO dark-matter 底圖 style** — Keyless vector basemap style for MapLibre. 93 layers, CJK-capable font stacks (HanWangHeiLight / NanumBarunGothic), glyph server at tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf. MUST be referenced as a style URL — passing it as an inline style object to MapLibre 4.7.x silently fails.
- **CSDI 空間數據共享平台 API** — VERIFIED — this is the reusable CSDI access pattern, two forms: (a) whole-dataset GeoJSON via /csdi-webpage/file-api?dataset_id=<id>&format=geojson&layer_name=<layer>; (b) ArcGIS FeatureServer at /server/rest/services/common/<dataset_id>/FeatureServer/0/query?where=1=1&outFields=*&f=geojson which ECHOES the Origin header, so it is CORS-open and usable straight from the browser. WFS GetFeature also works (typeNames=csdi:<layer>, outputFormat=geojson — use 'geojson' not 'json').
- **地政總署 地址搜尋（ALS / Location Search API）** — VERIFIED and this is the geocoder the app needs. REAL HOST IS www.als.gov.hk (the older als.ogcio.gov.hk / geodata.gov.hk guesses were wrong). Send Accept: application/json (defaults to XML). CORS is '*' so the browser can call it directly. Returns SuggestedAddress[] with GeospatialInformation{Latitude,Longitude,Easting,Northing} and a GeoAddress code. Whole address dataset: https://www.als.gov.hk/data/ALS-GeoJSON.zip. Use this to geocode news/event text — never let an LLM invent coordinates.
- **地政總署 Location Search API（GeoInfo Map）** — VERIFIED on the NEW hostname www.map.gov.hk (migrated from geodata.gov.hk around 2026-05-04). CORS '*'. Returns name/address/district in ZH+EN plus HK1980 grid x/y. Use ALS for addresses and this for place names.
- **天文台 氣象站網絡（含座標，CSDI）** — 氣象站位置圖層 —— 分區氣溫／風速要落圖就靠佢。用 CSDI FeatureServer 通用路徑，未實測（dataset id 來自 CSDI portal）。

## global

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| USGS 地震（香港 bbox） | `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minlatitude=22.0&maxlat…` | 🟢 ok | minutes | none | JSON object, keys: type, metadata, features |
| NASA EONET 自然事件 | `https://eonet.gsfc.nasa.gov/api/v3/events/geojson?bbox=113.7,22.0,114.5,22.7&status=open` | 🟢 ok | hourly | none | JSON object, keys: type, features |
| Open-Meteo 格網天氣（香港） | `https://api.open-meteo.com/v1/forecast?latitude=22.32&longitude=114.17&current=temperat…` | 🟢 ok | 15 minutes | none | JSON object, keys: latitude, longitude, generationtime_ms, utc_offset_seconds, timezone, timezone_abbreviation |

- **USGS 地震（香港 bbox）** — Keyless. Empty result near HK is expected and correct — widen the bbox for a regional view.
- **NASA EONET 自然事件** — Storms, wildfires, floods. Keyless. Large responses — filter client side by bounding box if the bbox param is unsupported.
- **Open-Meteo 格網天氣（香港）** — Keyless, CORS-friendly. Useful as a gridded cross-check against HKO station readings.

## 未解決 / 待辦

- `hko_radar` — 天文台 天氣雷達圖（256km） → image 88161B
- `hko_satellite` — 天文台 衛星雲圖 → image 187827B
- `td_speedmap` — 運輸署 行車速度圖 → not an HTTP endpoint (websocket or still unknown)
- `td_journeytime` — 運輸署 行車時間顯示器 → not an HTTP endpoint (websocket or still unknown)
- `bus_eta_citybus_nlb` — 城巴／新大嶼山巴士 ETA → 422 — endpoint exists, needs POST body/parameters
- `hkemobility_control_point` — 香港出行易 管制站狀況 → HTML page — title: HKeMobility
- `aisstream` — AISStream 船隻 AIS（WebSocket） → not an HTTP endpoint (websocket or still unknown)
- `fsd_press` — 消防處 新聞公報 → HTML page — title: 新聞公報 | 香港消防處
- `cc_fuel_price` — 消委會 油價資訊通（車用燃油價格） → HTML page — title: 今日折扣及優惠 - 消費者委員會油價資訊通
- `cc_online_price_watch` — 消委會 網上價格一覽通（超市格價） → HTML page — title: 搜尋貨品
- `cc_infant_formula_survey` — 消委會 嬰幼兒奶粉價格調查 → HTML page — title: 嬰幼兒配方奶粉價格調查 | 消費者委員會
- `cc_complaints_stats` — 消委會 投訴統計 → CSV ~1811 rows, cols: 
- `td_routes_and_fares` — 運輸署 公共交通路線及收費（巴士/小巴/渡輪/電車） → CSV ~42 rows, cols: ROUTE_ID, ROUTE_SEQ, CHANGE
- `lwb_eta` — 龍運巴士 ETA → 422 — endpoint exists, needs POST body/parameters
- `airplanes_live` — airplanes.live（403，唔用） → https://api.airplanes.live/v2/point/22.32/114.17/100 -> HTTP 403
- `censtatd_2021_census` — 2021 人口普查（最新已公佈） → HTML page — title: 住戶
- `centaline_ccl` — 中原城市指數 CCL／CRI（私人，冇公開 API） → HTML page — title: 地產新聞資訊 | 中原地產
- `hko_stations_network` — 天文台 氣象站網絡（含座標，CSDI） → JSON object, keys: type, features
- `sunferry_eta` — 新渡輪 下一班船 ETA（1 分鐘） → 422 — endpoint exists, needs POST body/parameters
- `tdas_traffic` — 運輸署 交通數據分析系統（5 分鐘） → https://tdas-api.hkemobility.gov.hk/tdas/api/route -> HTTP 403
