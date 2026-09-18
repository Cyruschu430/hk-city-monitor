# HK City Monitor — TECH_SPEC

> 香港本土實時態勢儀表板。全開源（AGPL-3.0）。
> 概念參考：`koala73/worldmonitor`（AGPL-3.0）＋「God's Eye View」城市監測。
> 狀態：v0.1 live（`legacy/index.html`）— 每項數據源都跑過真 fetch 才標 🟢。

## 0. 宗旨

> **數據嘅廣泛性、開放性、公開度 —— OSINT 就係要推動呢樣嘢。**

落成原則：
- **廣泛**：一有免費、公開、可 filter 到香港嘅源，就接。唔問「有冇用」，只問「係唔係真數據」。
- **開放**：所有源都喺 spec 公開列出（endpoint、更新頻率、要唔要 key、授權）。冇隱藏源。
- **公開**：每個數字都連得返去源頭。用戶可以自己驗證，唔需要信我。
- **一條線唔可以過**：開放係指**數據**。唔公開任何對個人嘅未經核實指控、唔做人物追蹤、唔收個資。見 §8。

## 1. 定位 / Non-goals

**做**：一個香港版實時態勢儀表板 —— 影像、天氣、交通、口岸、海空、政務、市場、空間基底，全部香港數據（或全球數據 filter 到香港範圍），放埋同一個地圖 + 面板。

**唔做**：
- ❌ 唔係政府「AI城市大腦」嘅一部分，亦**唔用「AI城市大腦」做產品名**（政府 2026-09-16 施政報告已用此名做官方系統，同名會令人誤會）
- ❌ 唔掂任何非公開數據（部門內部感測器、非公開後台）
- ❌ 唔做未經證實嘅推導評分；面板只顯示可溯源嘅原始觀測

## 2. 核心決定

| # | 決定 | 理由 |
|---|---|---|
| D1 | 以 **World Monitor** 為參照架構，同名 stack（Vite + TypeScript + MapLibre/deck.gl） | 佢本身單一 codebase 出多個 variant（world/tech/finance/…），加 HK variant 係官方支持路徑；圖層／面板／i18n／桌面殼全部現成，日後可以整層搬過去 |
| D2 | 產品用獨立名字 + 一句 "Based on World Monitor" 連回原 repo | AGPL 代碼可用，但商標政策要求 fork 用**唔同品牌**、要 factual attribution、唔可以暗示官方關聯 |
| D3 | MVP **零後端**：免 key 源直接由瀏覽器 fetch | HK 官方源（運輸署、天文台）**免 key、可 hotlink**。World Monitor 要 Redis 係因為 Windy 要 key + token 過期，HK 唔需要 |
| D4 | 靜態前端 → Cloudflare Pages（或 VPS nginx） | 對應現有架構：Pages = 舖頭、VPS = 工廠（只放要常駐嘅嘢：AIS WebSocket、NLP collector、cron） |
| D5 | 有 CORS 問題嘅源，用 nginx 3 行 proxy 解決，唔寫後端 | Yahoo Finance 冇 CORS header → `proxy_pass` 就夠（已實作，live） |

## 3. 數據源清單（全部實測過）

### 3.1 即時影像 🎥 — 核心差異化
| 源 | Endpoint | 更新 | Key | 狀態 |
|---|---|---|---|---|
| 運輸署交通快拍 **1013 台** | `https://tdcctv.data.one.gov.hk/{KEY}.JPG`（或 `/image?key={KEY}`） | 2 分鐘 | 無 | 🟢 實測 200、JPEG 320×240、~30KB。可能回 301/302 要跟 redirect |
| 運輸署攝影機清單 | `https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_Tc.csv` | 不定期 | 無 | 🟢 實測。**UTF-16LE + 雙 BOM + tab 分隔** |
| 天文台天氣攝影機 **34 站** | `https://www.hko.gov.hk/wxinfo/aws/hko_mica/{stn}/latest_HD_{STN}.jpg` | 5 分鐘 | 無 | 🟢 34/34 實測 200、HD 462KB（`latest_{STN}.jpg` = 88KB 細圖）。站號清單喺 `index_webcam.htm` |
| 電視台直播 | RTHK `UC6of7UYhctnYmqABjUqzuxw`／香港01 `UCTxyBu9VWUq5LXezXwy_SGg`／獨立媒體 `UCZpf3t79EhVe83Z76FZipCw` | 實時 | 無 | 🟢 `youtube.com/embed/live_stream?channel=…` 已 embed |

> ⚠️ **世界版做唔到嘅位**：World Monitor 個 webcam 層用 Windy API（65,000 台、5–15 分鐘、要 key、要 attribution），官方文檔自己寫「免費嘅真直播 video API 唔存在」。HK 兩個官方源**更快（2 分鐘）而且免 key**。但要用字準確：**快拍 / timelapse，唔係 24fps 直播**。

### 3.2 交通 🚗（全部免 key）
| 源 | Endpoint | 更新 | 狀態 |
|---|---|---|---|
| 行車速度圖（City Dashboard 版，JSON） | `https://static.data.gov.hk/opendata/dataset/traffic-speed/traffic-speed-info.json`（亦有 .csv） | 2 分鐘 | 🟢 實測 URL 由 CKAN 取得 |
| 行車速度圖（TIS 版） | ~~`resource.data.one.gov.hk/td/speedmap.xml`~~ | — | 🔴 **404**（之前以為存在，係估；個 404 頁面係一個假 PHP index 列出唔存在嘅路徑，呃咗我一次）。用上面 JSON 版；XML 真路徑要再搵 |
| 行車時間 | ~~`resource.data.one.gov.hk/td/journeytime.xml`~~ | — | 🔴 同樣 404。改用 City Dashboard journey-time dataset |
| 特別交通消息 | `https://resource.data.one.gov.hk/td/{tc,en,sc}/specialtrafficnews.xml` | 即時 | 🟢 |
| 停車場空位（整合版） | `https://api.data.gov.hk/v1/carpark-info-vacancy` | 即時 | 🟢 |
| 巴士 ETA（城巴＋新大嶼山） | `https://rt.data.gov.hk/v1/transport/batch/stop-eta`、`/v1.1/transport/batch/stop-route` | 1 分鐘 | 🟢 |
| 巴士 ETA（九巴／龍運） | KMB API | 1 分鐘 | 🟡 要免費註冊 key |
| 港鐵 / 輕鐵 | MTR API | 實時 | 🟡 待驗 |
| 的士車隊（am730 / Big Boss 等） | data.gov.hk 各有 dataset | 實時 | 🟡 待驗 |
| 電動車充電站（中電） | data.gov.hk | 不定期 | 🟡 |

### 3.3 口岸／關口 🛂
| 源 | Endpoint | 更新 | 狀態 |
|---|---|---|---|
| 保安局「口岸通」（綠／黃／紅＋平均輪候時間＋突發） | `https://www.sb.gov.hk/chi/bwt/status.html?type=outbound` | **15 分鐘** | 🟡 頁面實測 200，但數據由 JS 後載 → **要捉 JSON endpoint**（具體待辦） |
| 香港出行易 管制站狀況 | `https://www.hkemobility.gov.hk/tc/control-point` | 15 分鐘 | 🟡 頁面只有 3.5KB（純 JS app）→ 要捉 API |
| 13 個管制站清單＋開放時間 | 入境處 `immd.gov.hk/hkt/contactus/control_points.html` | 靜態 | 🟢 可直接寫死（可標「現正開放／已關閉」） |
| 出入境旅客流量（統計） | data.gov.hk | 日／月 | 🟢 非即時，只做背景數字 |
| 海關車輛清關統計 | `hk-customs-ced_stat-vehicle-clearance` | 月 | 🟢 非即時 |

### 3.4 航空 ✈️（免 key！）
| 源 | Endpoint | 更新 | 狀態 |
|---|---|---|---|
| **adsb.lol**（社群 ADS-B） | `https://api.adsb.lol/v2/point/{lat}/{lon}/{radius_nm}` | ~10 秒 | 🟢🟢 **實測香港 100nm 內 40 部飛機，零 key、零註冊** |
| OpenSky Network | `https://opensky-network.org/api/states/all?lamin=22.10&lomin=113.80&lamax=22.60&lomax=114.50` | ~10 秒 | 🟢 實測 23 部。匿名有速率限制，註冊免費提升 |
| 香港國際機場航班 | HKIA API | 15 分鐘 | 🟡 待驗 |

### 3.5 海事 🚢
| 源 | 更新 | 狀態 |
|---|---|---|
| AISStream.io（WebSocket，可 subscribe 香港 bbox） | 實時 | 🟡 免費但要註冊 key；**需要一個常駐連線 → 放 VPS，唔可以純靜態** |
| 海事處 抵港／離港船隻 | 15 分鐘 | 🟡 待驗（data.gov.hk） |
| 香港水流預測 | 每日 | 🟢 data.gov.hk |

> 「暗黑船隻」（關 AIS）唔做：需要衛星 AIS 商業授權，非公開範圍。

### 3.6 天氣／環境 🌦
| 源 | Endpoint | 更新 | 狀態 |
|---|---|---|---|
| 天文台開放數據 API | `https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType={warnsum\|warningInfo\|rhrread\|fnd\|hhOT\|swt}&lang=tc` | 實時～10 分鐘 | 🟢 逐個實測 200（`hhOT`=潮汐、`swt`=特別天氣提示）。**CORS `*` → 瀏覽器直接 fetch 得** |
| 雷達圖 / 衛星雲圖 / 過去一小時雨量 | HKO 圖像 | 實時 | 🔴 URL 未 pin 實（我試嘅幾個 pattern 都 404）— **待辦** |
| 空氣質素健康指數 AQHI（環保署） | — | 每小時 | 🔴 endpoint 未搵到（`aqhi.gov.hk` 猜嘅路徑全 404）— **待辦：去 data.gov.hk 搵真 dataset** |
| 伽馬輻射水平、閃電位置、地震速報 | HKO open data | 每小時／即時 | 🟡 待驗 |
| CEDD 斜坡感測器 | — | — | 🔴 非公開，唔納入 |

### 3.7 政務／新聞 📰（全部免 key）
| 源 | 狀態 |
|---|---|
| 政府新聞公報 RSS（全部＋**「治安」分類**） | 🟢 `gov.hk/tc/about/rss.htm` 列出全部 feed URL |
| 消防處新聞公報 | 🟢 有待 pin RSS/HTML |
| 立法會／區議會公開資料 | 🟡 |
| 1823 | 🔴 無公開 API |

### 3.8 全球免費 API（可 filter 到香港 bbox）🌍
| 源 | Filter 方式 | 更新 | 狀態 |
|---|---|---|---|
| USGS 地震 | bbox / 半徑 | 分鐘 | 🟢 免 key |
| NASA EONET（風暴／山火／水浸） | bbox | 小時 | 🟢 免 key |
| NASA FIRMS 熱點（山火） | bbox | 3 小時 | 🟡 免費 key |
| GDACS 災害 | 國家 | 小時 | 🟢 免 key |
| Open-Meteo（格網天氣） | lat/lon | 15 分鐘 | 🟢 免 key，可做 HKO 以外嘅格網對照 |
| Cloudflare Radar（網絡中斷） | 地區 | 即時 | 🟡 免費 key |

### 3.9 市場 💹
| 源 | 更新 | 狀態 |
|---|---|---|
| **Yahoo Finance chart API** | 延遲 | 🟢 實測免 key：`^HSI` 24750.78、`^HSCE` 8225.4、`0700.HK` 419、`9988.HK` 109.3。**要 proxy（無 CORS header）** |
| CoinGecko 加密貨幣 | 實時 | 🟢 免 key |
| Finnhub（正股） | 延遲 | 🟡 免費 key；港股覆蓋有限 |
| 港股即時 L1/L2 | 實時 | 🔴 **冇免費合法途徑**。券商／付費：Longbridge HK LV2 HK$558/月、Futu 要開戶買行情卡、iTick/TickDB 免費層配額極緊 |

### 3.10 市民須知 / 康文署 🏛 —「一個市民嚟緊要知嘅嘢」

data.gov.hk 有 **~180 個康文署／公民設施 dataset**。已查證幾項關鍵：

| 源 | Endpoint | 更新 | 狀態 |
|---|---|---|---|
| **康體活動節目**（未來約 1.5 個月活動） | `http://www.lcsd.gov.hk/datagovhk/event/leisure_prog.json` | 每日（每月 15 號上載） | 🟢 直接 JSON。**呢個就係「嚟緊有咩活動」** |
| **實時停車場空位** | `https://resource.data.one.gov.hk/td/carpark/basic_info_all.json` + `vacancy_all.json` | **即時** | 🟢 免 key |
| 康文署設施地理數據（~30 類：羽毛球場、籃球場、泳池、運動場、草地／硬地足球場、壁球場、乒乓球檯、網球場、健身室、單車場、燒烤場、渡假營、圖書館、博物館、公園動物園、表演場地…） | CSDI dataset | 季度／不定期 | 🟢 **逐類一個 CSDI dataset → 直接做圖層**。例：泳池 `lcsd_rcd_1634540558875_77434` |
| 泳池／泳灘入場人次 | `hk-lcsd-csdi-swimming-pools-attendance`、`hk-lcsd-stats-beaches-attd` | 月 | 🟢 做「幾多人」背景數字 |
| 郊野公園**封閉山徑** | CSDI `afcd_rcd_1742550096880_1424` | 有更新時 | 🟢 |
| 郊野公園**封閉設施** | CSDI `cpclosedfacilitiescsdi` | 有更新時 | 🟢 |
| 文化／演藝節目、URBTIX 節目 | `hk-lcsd-event-event-cultural`、`hk-lcsd-event-urbtix-event` | 每日 | 🟢 |
| 康文署設施使用率 | `hk-lcsd-facility-usage-facilities` | **每年** | 🟡 只係年度統計，唔係即時 |
| **即時訂場情況（book 場）** | — | — | 🔴 **唔存在公開 API**。康體通／Leisure Link 要登入，自動化查詢＝違反 ToS。誠實做法：出**設施地圖＋訂場窗口日曆＋開放時間表＋實時停車場空位**，唔好扮有 live vacancy |

**未查（TODO）**：康文署場地暫停開放公告、公眾泳池季節性開放時間表、圖書館臨時閉館、公眾假期表。

### 3.11 格價 💰（消費者價格）

data.gov.hk **冇**任何消費者格價數據（消委會只有投訴統計）。價格工具全部係消委會自己嘅網站，
**冇官方 API**。

| 源 | Endpoint | 更新 | 狀態 |
|---|---|---|---|
| **消委會 油價資訊通** | `https://oil-price.consumer.org.hk/tc/price`（另有 `/tc/today-discount`、`/tc/station`） | 每日 | 🟡 頁面實測 200。全港油站**零售價 + 折後價 + 每週優惠**。係伺服器渲染嘅 Typo3 站（純 GET、路徑穩定），唔使瀏覽器都捉得到 —— 但始終係 scraping。已有第三方（talklivelihood.hk）做緊同一件事。**最好嘅做法：正式向消委會要一個 feed** |
| **消委會 網上價格一覽通**（超市格價） | `https://online-price-watch.consumer.org.hk/opw/list/{類}/{子}/{細}` | 每週 | 🟡 分層 URL 穩定、唔使 JS，**但商品頁 HTML 內冇價錢** —— 價錢係另一個 AJAX 攞。比油價難做、易爛。都係建議先問 |
| 消委會 嬰幼兒配方奶粉價格調查 | `consumer.org.hk/tc/price-comparison-tools/infant-formula-price-survey` | 每月 | 🟡 實測 200，要睇係表格定 PDF |
| 消委會 投訴統計 | data.gov.hk `cc-complaints-complaints-statistics` | 每月 | 🟢 實測 CSV ~1811 行（唯一上 data.gov.hk 嘅消委會數據） |
| **運輸署 公共交通路線及收費**（巴士／小巴／渡輪／電車） | `static.data.gov.hk/td/routes-and-fares/FARE_BUS.csv` | 每日 | 🟡 **魔鬼細節**：啲 CSV 係**每日變更日誌**（只有 `ROUTE_ID, ROUTE_SEQ, CHANGE`），**完全冇收費數字**。真收費表藏喺 MS Access `.mdb`（`FARE_BUS.mdb` = **32.9 MB**）。全家：`ROUTE_/RSTOP_/STOP_/FARE_` × `BUS/GMB/FERRY/TRAM/PTRAM`。用法：`mdbtools` 一次性轉 SQLite/Parquet，之後每日食 delta。**呢個係全港唯一免費完整公共交通收費數據源，寫個 converter 係好有價值嘅開源貢獻** |
| 其他格價角度 | 電費（中電／港燈燃料調整費）、咪錶位收費、超市以外商戶 | 🟡 待查 |

### 3.12 環境／公共健康（部分待辦）
| 源 | 狀態 |
|---|---|
| 漁護署 郊野公園資料、封閉山徑／設施 | 🟢 見 §3.10 |
| 水務署 水塘水位、水務設施飲水機 | 🟡 data.gov.hk (`hk-wsd-*`) |
| 醫管局／衞生署 醫療設施 | 🟡 `hospital-hadata-health-care-facilities` |
| 無障礙設施（民政署、港鐵、復康會） | 🟡 多個 dataset |
| 公眾假期、政府公告 | 🟡 待 pin |

### 3.13 空間基底 🗺
| 源 | 更新 | 狀態 |
|---|---|---|
| CSDI WFS / WMS / ArcGIS REST | — | 🟢 |
| CSDI 3D 建築物（LoD2）／3D Visualisation Map（2025-09 新增非貼圖模型） | 季度 | 🟢 |
| CSDI DEM / 高程 | — | 🟢 |
| 地址搜尋（ALS / Location Search API） | — | 🟡 **hostname 2026-05-04 由 `geodata.gov.hk` 轉去 `www.map.gov.hk`**，落地前要 pin 實真 endpoint |
| 地政總署 GeoAddress | — | 🟡 |
| 底圖：CARTO dark-matter GL style | — | 🟢 免 key，`https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json` |
| data.gov.hk 全站目錄 | — | 🟢 CKAN API：**3,820 個 dataset**（`/api/3/action/package_list`）|

## 4. 圖層／面板路線圖

**已 live（v0.1）**：TD 快拍、HKO 天氣攝影機、天氣警告、本港現況、市場、相機牆、YouTube 直播、資料來源

**v0.2**：設計系統重寫（見 `DESIGN_BRIEF.md`）、全屏地圖 + 浮動面板、focus drawer、staleness 狀態系統、cluster 展開、鍵盤操作

**v0.3（全球源）**：飛機（adsb.lol）、地震（USGS）、EONET、行車速度、特別交通消息、停車場空位、巴士 ETA、AQHI、雷達／衛星圖

**v0.4（需要常駐連線，放 VPS）**：船隻 AIS（WebSocket）、口岸通輪候時間（捉 API）、事件 NLP 層

**v0.5**：3D（globe.gl 全球 ↔ MapLibre 城市）、CSDI 3D 建築物、timeline scrubber、變體（交通／天氣／市場）

## 5. 架構

```
┌─ 免 key、有 CORS ──────────────┐
│  靜態前端（Pages / nginx）      │   ← 大部分源
│  <img> 直連 + fetch            │
└────────────────────────────────┘
        │
        ├── 冇 CORS（Yahoo） → nginx proxy_pass（已完成）
        │
        ├── 要常駐連線（AIS WebSocket、口岸通 polling、NLP collector）
        │        → VPS 服務，輸出靜態 JSON（src 唔喺前端）
        │
        └── AI 摘要 → Ollama 本地 或 DeepSeek API（可選）
```

**共同契約**：VPS 上嘅 collector 一律輸出靜態 JSON，前端永遠只讀 JSON。新增數據源 = 加一個 collector + 一個圖層，核心邏輯唔改。

## 6. 每個源上線前必須

1. 真 fetch 一次，記錄 HTTP 狀態、size、更新時間戳 → 寫入 `SOURCES.md`
2. 面板層面顯示：來源名、來源連結、觀測時間、更新頻率
3. 有 stale / error 狀態，唔可以爆錯或顯示假數據
4. 超過 fresh 門檻要**視覺上降級**，唔可以扮 fresh
5. 冇授權唔可以轉載媒體內容（RSS 只出標題 + 連結）

## 7. 分階段

- **P0（已完成）** — 靜態頁 + MapLibre + TD 1013 台 + HKO 34 站 + 天氣警告 + 現況 + 市場 + 相機牆 + 直播。已 live 並實測。
- **P1（今晚）** — v0.2 設計系統重寫（`DESIGN_BRIEF.md`）+ 全球免費圖層（機／地震／交通／停車場／巴士）
- **P2** — 口岸通、AQHI、雷達、CSDI 3D 建築物
- **P3** — AIS 船隻（VPS）、事件 NLP 層（官方 RSS 先行）、AI brief
- **P4** — 變體、桌面版（Tauri）、MCP/REST API 供 agent 用

## 8. 界線 / 法律

- **授權**：AGPL-3.0-only，改動要照樣開源。獨立品牌 + "Based on World Monitor" 連結。
- **商標**：唔可以用 World Monitor 名／logo 做主品牌、唔可以暗示官方關聯。亦唔可以用「AI城市大腦」。
- **僱主**：唔提僱主、唔用僱主產品／品牌／數據、唔用申請中嘅資助字眼。
- **開放 ≠ 公開指控**：推動數據開放係宗旨；但**唔公開任何對個人嘅未經核實指控、唔做人物追蹤、唔收個資、唔收用戶上載相片**。任何群眾報料一律**只入私人收件箱 + 人手審核**，零自動發佈。
- **官方源優先**：涉及個人（失蹤人口、防罪）只鏡像官方公佈，只出標題 + 連回官方頁。
- **每個 panel 都要有來源聲明**；天氣警告一律以天文台公佈為準。

## 9. 未決定 / 未解決（全部由 `scripts/probe_sources.py` 追蹤）

跑 `python3 scripts/probe_sources.py` 會重新實測 **48 個源**，並生成 `SOURCES.md`（唔好手改）
＋ `data/sources_report.json`。以下係 🔴／🟡，即係仲要解決嘅：

1. **天文台雷達圖 256km** — 所有估嘅 pattern 都 404，要由雷達頁 JS 抽真 URL
2. **天文台衛星雲圖** — 同上
3. **天文台潮汐／輻射／地震速報** — `hhOT` 等 dataType 名錯（API 回「Please include valid parameters」），要查官方 API 文件 PDF
4. **環保署 AQHI** — 估嘅路徑全 404，要抽 aqhi.gov.hk 前端真正嘅 XHR
5. **保安局「口岸通」JSON** — 頁面真、數據係 JS 載入，要捉 endpoint（**最高價值嘅未解決項**）
6. **香港出行易 管制站 API** — 同上
7. **CSDI WFS / ArcGIS REST base** — 要一個真嘅 GetFeature 示範
8. **地址搜尋 ALS**（`www.map.gov.hk`）— 同上，新聞／事件 geocode 靠佢
9. **康文署 ~30 類設施 CSDI dataset** — 要可重用嘅下載／WFS 路徑
10. **漁護署封閉山徑／設施** — 同上
11. **香港公眾假期** — 未有 machine-readable 源
12. **AIS 船隻** — 要免費 key，而且要 VPS 常駐連線
13. **九巴／港鐵／機管局／渡輪 API** — 待驗（有啲要免費註冊）
14. **消委會兩個格價工具** — 冇 API；先考慮正式去信要 feed
15. **公共交通收費 `.mdb` → SQLite/Parquet converter** — 未寫
16. Repo 上唔上 GitHub（公開）／改咩名
