# SOURCES.md — 已實測數據源目錄

> **本檔案由 `scripts/probe_sources.py` 自動生成，唔好手改。**
> 改源 → 改 `sources.json` → 跑 `python3 scripts/probe_sources.py`。

最後實測：`2026-09-18 19:32 CST`　·　**20 / 20 個源成功**

每個 URL 都真係發過 HTTP 請求。🟢 = 200 而且回傳真數據　🟡 = 未解決／要 key　🔴 = 失敗。

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

## 未解決 / 待辦

（無）
