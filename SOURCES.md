# SOURCES.md — 已實測數據源目錄

> **本檔案由 `scripts/probe_sources.py` 自動生成，唔好手改。**
> 改源 → 改 `sources.json` → 跑 `python3 scripts/probe_sources.py`。

最後實測：`2026-09-18 19:23 CST`　·　**32 / 48 個源成功**

每個 URL 都真係發過 HTTP 請求。🟢 = 200 而且回傳真數據　🟡 = 未解決／要 key　🔴 = 失敗。

## cameras

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| 運輸署 交通快拍攝影機位置 | `https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.…` | 🟢 ok | irregular | none | CSV ~1013 rows, cols: ﻿key, region, district, description, easting, northing |
| 運輸署 交通快拍圖像（單張） | `https://tdcctv.data.one.gov.hk/H109F.JPG` | 🟢 ok | 2 minutes | none | image 32112B |
| 天文台 天氣攝影機（單站 HD） | `https://www.hko.gov.hk/wxinfo/aws/hko_mica/hko/latest_HD_HKO.jpg` | 🟢 ok | 5 minutes | none | image 582842B |
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
| 天文台 潮汐資料 | `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=hhOT&lang=tc` | 🔴 wrong-payload | hourly | none | declared JSON but unparseable (starts 'Please include valid parameters in API r') |
| 天文台 環境伽馬輻射水平 | `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=radiation&lang=tc` | 🔴 wrong-payload | hourly | none | declared JSON but unparseable (starts 'Please include valid parameters in API r') |
| 天文台 地震速報 | `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=qem&lang=tc` | 🔴 wrong-payload | as issued | none | declared JSON but unparseable (starts 'Please include valid parameters in API r') |
| 天文台 天氣雷達圖（256km） | `https://www.hko.gov.hk/wxinfo/radars/rad_1064.jpg -> HTTP 404; https://www.hko.gov.hk/w…` | 🔴 fail | 6 minutes | none | — |
| 天文台 衛星雲圖 | `not an HTTP endpoint (websocket or still unknown)` | 🟡 unprobeable | hourly | none | — |
| 環保署 空氣質素健康指數（AQHI） | `https://www.aqhi.gov.hk/epd/aqhi/rest/aqhi/getAllAqhi -> HTTP 404; https://www.aqhi.gov…` | 🔴 fail | hourly | none | — |

- **天文台 天氣警告一覽** — CORS allow-origin * so the browser can fetch directly. Returns {} when no warning is in force. Otherwise keyed by warning code with name, code, actionCode, issueTime, updateTime, expireTime.
- **天文台 詳細天氣警告資訊** — Full warning text, useful for a detail drawer.
- **天文台 本港現況（溫度、濕度、雨量、紫外線）** — temperature.data[] per place, humidity, rainfall.data[] per 18 districts, uvindex, icon. recordTime/updateTime fields carry the observation time.
- **天文台 特別天氣提示** — Returns a nearly-empty body when nothing is active.
- **天文台 潮汐資料** — dataType=hhOT is REJECTED ('Please include valid parameters') — wrong name. Find the correct tide dataType in the HKO Open Data API documentation PDF.
- **天文台 環境伽馬輻射水平** — Guessed dataType rejected. Find the correct one in the HKO Open Data API documentation PDF.
- **天文台 地震速報** — Guessed dataTypes rejected. Find the correct ones for the worldwide M6+ quick report and locally-felt tremor reports.
- **天文台 天氣雷達圖（256km）** — Real URL not yet pinned — all guessed patterns 404. The radar page loads the image from JS, so extract it from the page source.
- **天文台 衛星雲圖** — Real URL not yet pinned.
- **環保署 空氣質素健康指數（AQHI）** — Guessed paths all 404. Find the real XHR the aqhi.gov.hk front end calls, or the data.gov.hk resource for the AQHI dataset. Also want the AQHI station list with coordinates.

## transport

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| 運輸署 行車速度圖 | `not an HTTP endpoint (websocket or still unknown)` | 🟡 unprobeable | 2 minutes | none | — |
| 運輸署 行車時間顯示器 | `not an HTTP endpoint (websocket or still unknown)` | 🟡 unprobeable | 2 minutes | none | — |
| 運輸署 特別交通消息 | `https://resource.data.one.gov.hk/td/tc/specialtrafficnews.xml` | 🟢 ok | as issued | none | XML, 0 <item> entries, root tags: body, message, msgID, CurrentStatus, ChinText |
| 行車速度圖（City Dashboard 版，JSON） | `https://static.data.gov.hk/opendata/dataset/traffic-speed/traffic-speed-info.json` | 🟢 ok | 2 minutes | none | JSON array, 6 items |
| 運輸署 實時停車場空位 | `https://resource.data.one.gov.hk/td/carpark/vacancy_all.json` | 🔴 wrong-payload | real-time | none | declared JSON but unparseable (starts '\ufeff{"car_park":[{"park_id":"tdc166p1","veh') |
| 實時空置車位（一站式整合版） | `https://api.data.gov.hk/v1/carpark-info-vacancy` | 🟢 ok | real-time | none | JSON object, keys: results |
| 城巴／新大嶼山巴士 ETA | `https://rt.data.gov.hk/v1/transport/batch/stop-eta` | 🟡 needs-params | 1 minute | none | — |

- **運輸署 行車速度圖** — REAL PATHS NOT FOUND: resource.data.one.gov.hk/td/speedmap.xml returns 404 (the 404 body is a decoy PHP index that lists paths which do not exist). Use td_traffic_speed_city (JSON) instead; for XML find the current TIS path on data.gov.hk.
- **運輸署 行車時間顯示器** — REAL PATH NOT FOUND: resource.data.one.gov.hk/td/journeytime.xml returns 404. See the City Dashboard journey-time dataset on data.gov.hk.
- **運輸署 特別交通消息** — Also available in en and sc. Good event-feed source for the map.
- **行車速度圖（City Dashboard 版，JSON）** — JSON twin of the TIS XML — much easier for a static front end.
- **運輸署 實時停車場空位** — Real-time vacancy counts. The JSON body starts with a UTF-8 BOM — decode as utf-8-sig or json.loads throws. Key: car_park[].
- **實時空置車位（一站式整合版）** — Merges TD and Kai Tak (start-up Kowloon East) car park feeds.
- **城巴／新大嶼山巴士 ETA** — Batch endpoint — a GET returns 422, it needs a POST body of stop ids. Also has per-route ETA endpoints under rt.data.gov.hk.

## border

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| 保安局「口岸通」陸路管制站情況 | `https://www.sb.gov.hk/chi/bwt/status.html?type=outbound` | 🟡 ok | 15 minutes | none | HTML page — title: 口岸通 |
| 香港出行易 管制站狀況 | `https://www.hkemobility.gov.hk/tc/control-point` | 🟡 ok | 15 minutes | none | HTML page — title: HKeMobility |
| 入境處 13 個出入境管制站＋開放時間 | `https://www.immd.gov.hk/hkt/contactus/control_points.html` | 🟢 ok | static | none | HTML page — title: 出入境管制站地點 | 入境事務處 |

- **保安局「口岸通」陸路管制站情況** — Green/yellow/red status plus average waiting time per land control point, and incident notices. The page itself has no data — find the JSON endpoint its JS calls. Highest-value unresolved source.
- **香港出行易 管制站狀況** — Page is a ~3.5KB JS app. Find its data endpoint. Covers passenger and private-car channels.
- **入境處 13 個出入境管制站＋開放時間** — Static list of 13 control points with opening hours. Hardcode once — lets the UI show 現正開放／已關閉 without any live source.

## aviation

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| adsb.lol 香港範圍航班（社群 ADS-B） | `https://api.adsb.lol/v2/point/22.32/114.17/100` | 🟢 ok | ~10 seconds | none | JSON object, keys: ac, msg, now, total, ctime, ptime |
| OpenSky Network 香港 bbox | `https://opensky-network.org/api/states/all?lamin=22.10&lomin=113.80&lamax=22.60&lomax=1…` | 🟢 ok | ~10 seconds | register | JSON object, keys: time, states |

- **adsb.lol 香港範圍航班（社群 ADS-B）** — NO KEY, NO REGISTRATION. Verified: 40 aircraft within 100nm of Hong Kong. This is the practical flights layer — OpenSky's anonymous tier is rate-limited. Radius in nautical miles.
- **OpenSky Network 香港 bbox** — Verified: 23 aircraft in the HK bbox anonymously. Free account raises the rate limit. Use as fallback to adsb.lol.

## marine

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| AISStream 船隻 AIS（WebSocket） | `not an HTTP endpoint (websocket or still unknown)` | 🟡 unprobeable | real-time | free-key | — |

- **AISStream 船隻 AIS（WebSocket）** — Free API key. WebSocket with a bounding-box subscription — CANNOT run from a static page. Needs a persistent VPS collector that writes static JSON. Dark ships (AIS off) need paid satellite AIS: out of scope.

## civic

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| 康文署 康體活動節目（未來約 1.5 個月） | `https://www.lcsd.gov.hk/datagovhk/event/leisure_prog.json` | 🟢 ok | daily | none | JSON array, 629 items |
| 康文署 康體設施使用率（年度） | `https://www.lcsd.gov.hk/datagovhk/facility/lcsd_Activity_Room_tc.csv` | 🟢 ok | annual | none | CSV ~262 rows, cols: 年份, 設施, 場地, 使用率, 地區, 備註 |
| 康文署 設施地理數據（約 30 類，CSDI） | `not an HTTP endpoint (websocket or still unknown)` | 🟡 unprobeable | quarterly | none | — |
| 漁護署 郊野公園封閉山徑 | `not an HTTP endpoint (websocket or still unknown)` | 🟡 unprobeable | on update | none | — |
| 香港公眾假期 | `not an HTTP endpoint (websocket or still unknown)` | 🟡 unprobeable | annual | none | — |

- **康文署 康體活動節目（未來約 1.5 個月）** — This is the 'what's on soon' feed. Note the http (not https) scheme. Try the https variant too and prefer it if it works.
- **康文署 康體設施使用率（年度）** — Annual statistics only — NOT live booking availability. Do not present as real-time.
- **康文署 設施地理數據（約 30 類，CSDI）** — One CSDI dataset per facility type (swimming pools, sports centres, tennis courts, badminton courts, basketball courts, libraries, museums, parks and zoos, holiday camps, barbecue areas, ...). Need the reusable WFS / ArcGIS REST FeatureServer access path. Example dataset id: lcsd_rcd_1634540558875_77434 (swimming pools).
- **漁護署 郊野公園封閉山徑** — CSDI dataset afcd_rcd_1742550096880_1424. Also see the closed-facilities dataset (cpclosedfacilitiescsdi).
- **香港公眾假期** — Find a machine-readable JSON/CSV/ICS source (data.gov.hk or gov.hk).

## prices

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| 消委會 油價資訊通（車用燃油價格） | `https://oil-price.consumer.org.hk/tc/today-discount` | 🟡 ok | daily | none | HTML page — title: 今日折扣及優惠 - 消費者委員會油價資訊通 |
| 消委會 網上價格一覽通（超市格價） | `https://online-price-watch.consumer.org.hk/opw/list/001/001/001` | 🟡 ok | weekly | none | HTML page — title: 搜尋貨品 |
| 消委會 嬰幼兒奶粉價格調查 | `https://www.consumer.org.hk/tc/price-comparison-tools/infant-formula-price-survey` | 🟡 ok | monthly | none | HTML page — title: 嬰幼兒配方奶粉價格調查 | 消費者委員會 |
| 消委會 投訴統計 | `https://data.gov.hk/tc-data/dataset/cc-complaints-complaints-statistics` | 🟡 ok | monthly | none | CSV ~1811 rows, cols:  |
| 運輸署 公共交通路線及收費（巴士/小巴/渡輪/電車） | `https://static.data.gov.hk/td/routes-and-fares/FARE_BUS.csv` | 🟡 ok | daily | none | CSV ~42 rows, cols: ROUTE_ID, ROUTE_SEQ, CHANGE |

- **消委會 油價資訊通（車用燃油價格）** — Every oil company's retail price AND after-discount price per station, plus weekly offers. NO official API — it is a server-rendered Typo3 site (plain GET, stable paths such as /tc/price, /tc/station, /tc/today-discount), so it is scrapeable without a browser, but it is still scraping. A third party (talklivelihood.hk) already republishes it. BEST MOVE: ask the Consumer Council for a feed — a public body publishing a consumer tool should be able to publish data. No price data on data.gov.hk (only complaints statistics).
- **消委會 網上價格一覽通（超市格價）** — Supermarket prices across the major chains (惠康, 百佳, Market Place, AEON, 大昌, city'super...) for hundreds of product categories. Hierarchical server-rendered URLs (/opw/list/{cat}/{sub}/{subsub}) but the product pages carry NO prices in the HTML — prices arrive via an AJAX call that still needs reversing. Higher effort and higher fragility than the fuel tool. Prefer asking for a feed.
- **消委會 嬰幼兒奶粉價格調查** — Part of the Consumer Council price-comparison toolkit. Check whether the survey is published as a table or a PDF.
- **消委會 投訴統計** — The ONLY Consumer Council dataset on data.gov.hk. Resolve the real CSV resource URL via the CKAN API.
- **運輸署 公共交通路線及收費（巴士/小巴/渡輪/電車）** — GOTCHA: the CSVs are DAILY CHANGE LOGS only (ROUTE_ID, ROUTE_SEQ, CHANGE = ADD/DELETE/UPDATE) — they contain NO fares. The real fare tables are MS Access files, e.g. FARE_BUS.mdb at 32.9 MB. Full family available: ROUTE_/RSTOP_/STOP_/FARE_ x BUS, GMB (minibus), FERRY, TRAM, PTRAM. To use it: convert the .mdb to SQLite/Parquet once with mdbtools, then apply the daily deltas. A one-off converter is a genuinely useful open-source contribution and the only free source of complete HK public-transport fares.

## news

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| 政府新聞公報 RSS（全部） | `https://www.info.gov.hk/gia/rss/general_zh.xml` | 🟡 ok | as issued | none | XML, 100 <item> entries, root tags: rss, channel, title, link, image |
| 消防處 新聞公報 | `https://www.hkfsd.gov.hk/chi/fsd_info/publications/pressrelease/` | 🟡 ok | as issued | none | HTML page — title: 新聞公報 | 香港消防處 |

- **政府新聞公報 RSS（全部）** — VERIFIED: 100 items. Publish TITLE + LINK ONLY — never republish article bodies. Still want the 治安 (law and order) topic feed; the full feed list is on gov.hk/tc/about/rss.htm.
- **消防處 新聞公報** — Find an RSS/JSON form of this list if one exists.

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
| CSDI 空間數據共享平台 API | `https://portal.csdi.gov.hk/geoportal/` | 🔴 wrong-payload | varies | none | declared JSON but unparseable (starts '\r\n\r\n\r\n\r\n\r\n\r\n\r\n<!DOCTYPE html>\r\n<html lan') |
| 地政總署 地址搜尋（ALS / Location Search API） | `https://www.map.gov.hk/` | 🔴 wrong-payload | monthly | none | declared JSON but unparseable (starts '<html>\r\n<head>\r\n<title>GeoInfo Map</titl') |

- **CARTO dark-matter 底圖 style** — Keyless vector basemap style for MapLibre. 93 layers, CJK-capable font stacks (HanWangHeiLight / NanumBarunGothic), glyph server at tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf. MUST be referenced as a style URL — passing it as an inline style object to MapLibre 4.7.x silently fails.
- **CSDI 空間數據共享平台 API** — Need the real WFS / ArcGIS REST base and one demonstrated GetFeature returning GeoJSON.
- **地政總署 地址搜尋（ALS / Location Search API）** — Hostname moved from geodata.gov.hk to www.map.gov.hk effective 2026-05-04. Need the working address-to-coordinates query. Used for geocoding news/event text — do NOT let an LLM invent coordinates.

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

- `hko_tide` — 天文台 潮汐資料 → endpoint exists but rejects these parameters (wrong dataType / missing args)
- `hko_radiation` — 天文台 環境伽馬輻射水平 → endpoint exists but rejects these parameters (wrong dataType / missing args)
- `hko_earthquake` — 天文台 地震速報 → endpoint exists but rejects these parameters (wrong dataType / missing args)
- `hko_radar` — 天文台 天氣雷達圖（256km） → https://www.hko.gov.hk/wxinfo/radars/rad_1064.jpg -> HTTP 404; https://www.hko.gov.hk/wxinfo/radars/radar_256_1024.jpg -> HTTP 404; https://www.hko.gov.hk/wxinfo/radars/r_256_1024.jpg -> HTTP 404
- `hko_satellite` — 天文台 衛星雲圖 → not an HTTP endpoint (websocket or still unknown)
- `epd_aqhi` — 環保署 空氣質素健康指數（AQHI） → https://www.aqhi.gov.hk/epd/aqhi/rest/aqhi/getAllAqhi -> HTTP 404; https://www.aqhi.gov.hk/api/aqhi -> HTTP 404
- `td_speedmap` — 運輸署 行車速度圖 → not an HTTP endpoint (websocket or still unknown)
- `td_journeytime` — 運輸署 行車時間顯示器 → not an HTTP endpoint (websocket or still unknown)
- `td_carpark_vacancy` — 運輸署 實時停車場空位 → 200 but the body is not parseable as declared
- `bus_eta_citybus_nlb` — 城巴／新大嶼山巴士 ETA → 422 — endpoint exists, needs POST body/parameters
- `sb_bwt_status` — 保安局「口岸通」陸路管制站情況 → HTML page — title: 口岸通
- `hkemobility_control_point` — 香港出行易 管制站狀況 → HTML page — title: HKeMobility
- `aisstream` — AISStream 船隻 AIS（WebSocket） → not an HTTP endpoint (websocket or still unknown)
- `lcsd_csdi_facilities` — 康文署 設施地理數據（約 30 類，CSDI） → not an HTTP endpoint (websocket or still unknown)
- `afcd_closed_trails` — 漁護署 郊野公園封閉山徑 → not an HTTP endpoint (websocket or still unknown)
- `hk_public_holidays` — 香港公眾假期 → not an HTTP endpoint (websocket or still unknown)
- `gov_press_rss` — 政府新聞公報 RSS（全部） → XML, 100 <item> entries, root tags: rss, channel, title, link, image
- `fsd_press` — 消防處 新聞公報 → HTML page — title: 新聞公報 | 香港消防處
- `csdi_portal_api` — CSDI 空間數據共享平台 API → 200 but the body is not parseable as declared
- `als_address_lookup` — 地政總署 地址搜尋（ALS / Location Search API） → 200 but the body is not parseable as declared
- `cc_fuel_price` — 消委會 油價資訊通（車用燃油價格） → HTML page — title: 今日折扣及優惠 - 消費者委員會油價資訊通
- `cc_online_price_watch` — 消委會 網上價格一覽通（超市格價） → HTML page — title: 搜尋貨品
- `cc_infant_formula_survey` — 消委會 嬰幼兒奶粉價格調查 → HTML page — title: 嬰幼兒配方奶粉價格調查 | 消費者委員會
- `cc_complaints_stats` — 消委會 投訴統計 → CSV ~1811 rows, cols: 
- `td_routes_and_fares` — 運輸署 公共交通路線及收費（巴士/小巴/渡輪/電車） → CSV ~42 rows, cols: ROUTE_ID, ROUTE_SEQ, CHANGE
