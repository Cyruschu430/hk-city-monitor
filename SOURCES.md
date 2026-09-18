# SOURCES.md — 已實測數據源目錄

> **本檔案由 `scripts/probe_sources.py` 自動生成，唔好手改。**
> 改源 → 改 `sources.json` → 跑 `python3 scripts/probe_sources.py`。

最後實測：`2026-09-18 19:33 CST`　·　**55 / 65 個源成功**

每個 URL 都真係發過 HTTP 請求。🟢 = 200 而且回傳真數據　🟡 = 未解決／要 key　🔴 = 失敗。

## cameras

| 源 | Endpoint | 狀態 | 更新 | Auth | 回傳 |
|---|---|---|---|---|---|
| 運輸署 交通快拍攝影機位置 | `https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.…` | 🟢 ok | irregular | none | CSV ~1013 rows, cols: key, region, district, description, easting, northing |
| 運輸署 交通快拍圖像（單張） | `https://tdcctv.data.one.gov.hk/H109F.JPG` | 🟢 ok | 2 minutes | none | image 33374B |
| 天文台 天氣攝影機（單站 HD） | `https://www.hko.gov.hk/wxinfo/aws/hko_mica/hko/latest_HD_HKO.jpg` | 🟢 ok | 5 minutes | none | image 591911B |
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
| 運輸署 實時停車場空位 | `https://resource.data.one.gov.hk/td/carpark/vacancy_all.json` | 🟢 ok | real-time | none | JSON object, keys: car_park |
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
| 政府新聞公報 RSS（全部） | `https://www.info.gov.hk/gia/rss/general_zh.xml` | 🟢 ok | as issued | none | XML, 100 <item> entries, root tags: rss, channel, title, link, image |
| 消防處 新聞公報 | `https://www.hkfsd.gov.hk/chi/fsd_info/publications/pressrelease/` | 🟡 ok | as issued | none | HTML page — title: 新聞公報 | 香港消防處 |
| 政府新聞網 治安（法治）分類 feed | `https://www.news.gov.hk/tc/categories/law_order/html/articlelist.rss.xml` | 🟢 ok | continuous | none | XML, 20 <item> entries, root tags: rss, channel, title, link, image |

- **政府新聞公報 RSS（全部）** — VERIFIED valid RSS 2.0, ~478KB, ~100 items. NOTE: general.xml (no suffix) is 404. Publish TITLE + LINK ONLY — never republish article bodies.
- **消防處 新聞公報** — Find an RSS/JSON form of this list if one exists.
- **政府新聞網 治安（法治）分類 feed** — The 治安 topic feed. Other topics follow the same pattern: admin, finance, environment, health, infrastructure, school_work, city_life. Title + link only in our UI.

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

- **CARTO dark-matter 底圖 style** — Keyless vector basemap style for MapLibre. 93 layers, CJK-capable font stacks (HanWangHeiLight / NanumBarunGothic), glyph server at tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf. MUST be referenced as a style URL — passing it as an inline style object to MapLibre 4.7.x silently fails.
- **CSDI 空間數據共享平台 API** — VERIFIED — this is the reusable CSDI access pattern, two forms: (a) whole-dataset GeoJSON via /csdi-webpage/file-api?dataset_id=<id>&format=geojson&layer_name=<layer>; (b) ArcGIS FeatureServer at /server/rest/services/common/<dataset_id>/FeatureServer/0/query?where=1=1&outFields=*&f=geojson which ECHOES the Origin header, so it is CORS-open and usable straight from the browser. WFS GetFeature also works (typeNames=csdi:<layer>, outputFormat=geojson — use 'geojson' not 'json').
- **地政總署 地址搜尋（ALS / Location Search API）** — VERIFIED and this is the geocoder the app needs. REAL HOST IS www.als.gov.hk (the older als.ogcio.gov.hk / geodata.gov.hk guesses were wrong). Send Accept: application/json (defaults to XML). CORS is '*' so the browser can call it directly. Returns SuggestedAddress[] with GeospatialInformation{Latitude,Longitude,Easting,Northing} and a GeoAddress code. Whole address dataset: https://www.als.gov.hk/data/ALS-GeoJSON.zip. Use this to geocode news/event text — never let an LLM invent coordinates.
- **地政總署 Location Search API（GeoInfo Map）** — VERIFIED on the NEW hostname www.map.gov.hk (migrated from geodata.gov.hk around 2026-05-04). CORS '*'. Returns name/address/district in ZH+EN plus HK1980 grid x/y. Use ALS for addresses and this for place names.

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
- `bus_eta_citybus_nlb` — 城巴／新大嶼山巴士 ETA → 422 — endpoint exists, needs POST body/parameters
- `sb_bwt_status` — 保安局「口岸通」陸路管制站情況 → HTML page — title: 口岸通
- `hkemobility_control_point` — 香港出行易 管制站狀況 → HTML page — title: HKeMobility
- `aisstream` — AISStream 船隻 AIS（WebSocket） → not an HTTP endpoint (websocket or still unknown)
- `fsd_press` — 消防處 新聞公報 → HTML page — title: 新聞公報 | 香港消防處
- `cc_fuel_price` — 消委會 油價資訊通（車用燃油價格） → HTML page — title: 今日折扣及優惠 - 消費者委員會油價資訊通
- `cc_online_price_watch` — 消委會 網上價格一覽通（超市格價） → HTML page — title: 搜尋貨品
- `cc_infant_formula_survey` — 消委會 嬰幼兒奶粉價格調查 → HTML page — title: 嬰幼兒配方奶粉價格調查 | 消費者委員會
- `cc_complaints_stats` — 消委會 投訴統計 → CSV ~1811 rows, cols: 
- `td_routes_and_fares` — 運輸署 公共交通路線及收費（巴士/小巴/渡輪/電車） → CSV ~42 rows, cols: ROUTE_ID, ROUTE_SEQ, CHANGE
