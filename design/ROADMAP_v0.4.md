# ROADMAP v0.4 — 實作計劃（ANALYTICS.md + new-sources.md）

> 呢份係**計劃**，唔係實作記錄。來源：Cyrus 2026-09-22 交嚟嘅兩份文件
> `hkcm-ANALYTICS.md`（Tier 0–4 分析架構）同 `hkcm-new-sources.md`（新數據源清單）。
> 每一項都寫咗「做咩 / 點做 / 驗收」，跟返 repo 現有紀律：config-driven、四態誠實、
> 每個數字可溯源、US$0 鐵律、runtime 冇 LLM、冇 secret 入 repo。

---

## 0. 現況一句話

前端 v0.3.0 已經係 config-driven（172 源、21 panel、4 vertical、8 render type、四態誠實），
48 項瀏覽器驗收全綠。**未做**：任何分析層（Tier 0–4）、飛機／船／風場圖層、RFZ。

---

## PART A — 分析層（ANALYTICS.md）

### A0. 架構決定（同現有 stack 一致）

```
Cron（Cloudflare Cron Trigger Worker，免費計劃有）
  ↓ 讀 sources.json 內所有實時源
Tier 0 更新基線   →  KV / static JSON
Tier 1 跑規則     →  事件（結構化 JSON）
Tier 2 地理匯聚   →  綜合事件
Tier 3 有事件先叫 LLM 寫 2–3 句（失敗／超時 → template）
Tier 4 每日 08:00 一次簡報
  ↓
寫入 data/analysis.json（靜態）
  ↓
前端直接讀 —— 瀏覽器零 key、零 per-visitor 成本
```

**鐵律（照抄，唔准改）**：Tier 0–2 全部確定性規則；LLM 只做 Tier 3–4 嘅「講法」。
UI 一律寫「**同時發生**」，**唔准寫「因為」**（法律＋信譽風險）。

### A1. Tier 0 — 基線
- 存法：`signal_id × bucket_hour(0–23) × bucket_dow(0–6)` → `count/sum/sum_sq/min/max/last_updated`
- **≥14 日先算有基線**；不足 → UI 顯示「累積中 · 已 X 日 / 14 日」，**唔准出基線類事件**
- 落腳：`worker/` 加 Cron handler；`data/baselines.json`（100 訊號 × 168 桶 ≈ 16,800 行，JSON 夠用）
- 驗收：同一輸入兩次跑 → 同一輸出（決定性 unit test）；<14 日 → 零基線事件（test）

### A2. Tier 1 — 異常規則
- 規則格式照 ANALYTICS.md §3（`when: {field, op, value}` / `baseline_aware`），**入 config 唔入 code**
- 建議新檔 `data/rules.json`，由 `scripts/validate_config.py` 一齊驗（新增檢查：
  `source` 存在、`op` 喺封閉清單、`severity ∈ 1..3`、雙語 headline）
- v0 規則表照文件 §3 嗰 11 條（wsd_active／ae_wait_long／immd_queue／hko_warning／aqhi_poor…）
- 驗收：`python scripts/validate_config.py` 綠燈；規則命中／唔命中各一個 test

### A3. Tier 2 — 地理匯聚（護城河）
- 定義：同一區（官方 18 區界）＋ 60 分鐘窗 ＋ ≥2 個領域 → 綜合事件
- `score = 領域數 × 3 + 最高嚴重程度 × 2 + 事件總數`
- **區界用官方 18 區界**（唔准自己畫）→ 用返現成 CSDI district polygon（我哋已經有）
- 時間窗係 config 值
- 驗收：餵人造事件（同區、3 領域）→ 出 1 個匯聚、score 正確（test）
- UI：新 panel（`list` render）顯示「同一時段內同時發生：水務／交通／醫療」＋每項出處連結

### A4. Tier 3/4 — 敘述同簡報
- LLM 只准重述 JSON 事實；prompt 明寫 *"Only restate the facts in the JSON. Do not infer causation. Do not add context."*
- **一定有 template fallback**，LLM 死 → 功能唔停
- 只喺有事件時叫；每日一次簡報（08:00 HKT）
- 驗收：斷開 LLM → 簡報照出（用 template 版本）；UI 每條數字有出處連結

---

## PART B — 新數據源（new-sources.md）

### B0. ⚠️ 文件捉到嘅 bug：`hko_radar` 時戳
- 文件指出 sources.json 嗰條硬編時戳 URL 永遠 404 —— **我哋前端已經修咗**：
  `parsers.ts radarCandidates()` runtime 砌 `{YYYYMMDDHHMM}`、HKT、6 分鐘一格、回退 −6/−12/−18；
  已驗收（`✓ 雷達 URL: …202609181924.jpg → …202609181906.jpg`）
- **跟進**：把 sources.json 嗰條 entry 嘅 `url` 改成模板寫法＋註明（避免下個人再中招）

### B1. 🛩️ 飛機（adsb.fi 主 + adsb.lol 備）
- 兩條端點都免 key、ODbL 1.0（要 attribution）
- **重點**：回傳 key 唔同（fi = `aircraft`，lol = `ac`）→ 一個 adapter 兩個 parser
- 落地：新 source `adsb_fi` / `adsb_lol` + adapter；deck.gl `IconLayer` 用 **plane glyph**
  （`symbols.ts` 已經有 `plane`），**依 `track` 旋轉**，`roll` 可做側傾
- ⚠️ 唔用 OpenSky（授權非商業）
- 驗收：map 上見到 ≥30 架、每架有 heading；hover 出 callsign/高度/速度；載入 <1s

### B2. 🚢 船（AIS）— 架構決定待 Cyrus
- **唔可以用 Durable Object**：免費計劃冇 DO；DO hibernation 唔支援出站 WebSocket → 會長佔記憶體 → 要 US$5/月 → **違反 US$0 鐵律**
- **建議（文件提議，未驗證）**：Cron Trigger Worker 每 N 分鐘開 WebSocket 收 30–60 秒 → 寫 KV
- 落腳：`worker/` 加 cron handler；前端讀 KV 出嘅 JSON
- 驗收：cron 跑一次 → KV 有船舶位置；覆蓋率要**先量度**（香港係 AIS 弱覆蓋區，畫出嚟前要知）
- 🚧 未決定：接受 Cron 做法？定先用海事處抵港／離港頂住？

### B3. 🚗 交通（TomTom + TD 路網）
- TomTom：50k tiles/日、免卡、可商用、metered 但**冇卡=收唔到錢**；**申請完千萬唔好加卡**
- TD 路網（808 路段）已喺 sources.json，但**冇車速／流量**，純位置參考
- 落地：TomTom 要 key → 只可以放 Worker env（`wrangler secret put`），前端讀 proxy
- 驗收：map 見到路段着色（紅／黃／綠）；前端 bundle 冇 key（grep 檢查）

### B4. 🚁 無人機禁飛區（RFZ）
- 官方只有 eSUA 網頁**人手匯出**（`exportZip()`）；data.gov.hk／CSDI 都冇
- 做法：Cyrus 人手匯出 GeoJSON → commit 做**靜態參考圖層**（同行政區界一類，唔受「只做實時」限制）
- **唔准自動抓**（踩反爬 + token + 政府系統）
- 驗收：圖層畫到 RFZ 多邊形＋hover 出名稱；檔案有出處／匯出日期註明

### B5. 🌬️ 風場 Flow Render（HKO 30 站）
- 用 `geoql/maplibre-gl-wind`（deck.gl 粒子、GPU transform feedback）——**stack 已經係 MapLibre + deck.gl，即插即用**
- HKO 10 分鐘風 30 站（含離島），IDW 插值成格網
- **⚠️ 誠實要求（照抄）**：冇站嘅地方**唔准生安個風場** → 由最近站距離**淡出**（~15km 外全透明）
- 唔加 Open-Meteo（解析度粗到只有 34 格 + 429 rate limit；HKO 係實測）
- 驗收：風場動起來；離岸 15km 外透明；hover 出「最近站 XXX · 距離 X km」

### B6. 🎁 其他
- `hko_stations_network` 係真 GeoJSON（87KB，有齊座標）→ 做**氣象站圖層**（`station-wind` glyph 已備）
- CSDI 民航處：飛機噪音分佈（22 點）、滑翔傘活動區（8 點）→ 順手加
- `license` 欄位：sources.json 加 `license`（抄 OpenSky 主動標明授權嘅做法）→ validator 檢查有值

---

## PART C — 要 Cyrus 決定／提供嘅嘢（5 條）

| # | 問題 | 影響 |
|---|---|---|
| 1 | **禁飛區**：係唔係指 eSUA 個「匯出」掣？有冇見過真 download 頁？ | 決定 RFZ 點入 repo |
| 2 | **AIS 架構**：接受「Cron Trigger 每 N 分鐘收 30 秒」？定先用海事處抵港／離港頂住？ | 決定船圖層做唔做 |
| 3 | **TomTom**：要唔要申請？（**記住唔好加信用卡**） | 決定交通着色層 |
| 4 | **sources.json 加 `license` 欄位**？ | 法務清晰度 |
| 5 | **CSDI 2,243 服務**：要唔要我做一次掃描，睇吓仲有咩官方圖層應加入？ | 覆蓋廣度 |

---

## PART D — 建議次序（每個 dispatch 一件事）

1. **D1**：sources.json `license` 欄位 + hko_radar entry 改模板寫法（文檔債，最平）✅ **完成**
2. **D2**：飛機圖層（adsb.fi + lol，plane glyph + track 旋轉）✅ **完成**
3. **D3**：Tier 0/1（基線 + 規則引擎 + `data/rules.json` + validator 擴充 + unit test）
4. **D4**：Tier 2 匯聚（官方 18 區界 + 60 分鐘窗 + score）＋ UI panel（「同時發生」字眼）
5. **D5**：風場 flow render（IDW + 距離淡出）＋ 氣象站圖層 ✅ **完成（風羽方案，零新依賴）**
6. **D6**：Tier 3/4（LLM 敘述 + template fallback + 每日簡報）
7. **D7**：AIS（待決定）／TomTom（待 key）／RFZ（待 Cyrus 匯出）

---

## PART D2 — 實作進度（2026-09-23 實測，唔係計劃）

### ✅ D1 完成
- `license` 欄位：**165/175** 有。剩 10 個**故意留空**（未讀過條款唔准估），validator 出 warning 而唔係 error，令缺口可見但唔逼人亂填。
- `hko_radar` URL 改 `{YYYYMMDDHHMM}` 模板；validator 新增「URL 唔准有硬編時戳」檢查（實測三種情況：硬編中招、模板過、純檔名過）。
- **踩過嘅坑**：`apply_licenses.py` 第一版硬編 1-space 縮排，改寫咗 2-space 檔案 → 165 行改動變成 2988 行 diff，review 睇唔到真正改咗乜。已改成自動偵測縮排。

### ✅ D2 完成
- `adsb_fi_hk` + `adsb_lol_hk` 落地，panel（status_grid）+ 地圖圖層（plane glyph，依 `bearing` 旋轉）。
- **實測兩個 feed 有三處唔同**，全部係「讀一份就中招」：
  1. **Envelope key**：fi = `aircraft`，lol = `ac`。讀錯 → 空 array → 地圖顯示「香港上空冇飛機」（最誤導嘅失敗）。
  2. **時戳單位**：同一刻 fi = `1790099582`（**秒**），lol = `1790099583501`（**毫秒**）。當兩者都係毫秒 → fi 變成 1970 年 → age 56 年 → 永遠 stale。
  3. **`alt_baro` 係字串 `"ground"`**：唔係高度 0。畫成 0 會令停機坪飛機飛咗上半空。
- 飛機**唔 cluster**（會移動，cluster 會不斷重組，遮住本身要睇嘅軌跡）。
- 圖層加暗底光環：純白色機頭喺暗底圖上係一粒睇唔到嘅點（同相機層當初一樣）。
- Harness 順手修好兩個真問題：rail 位置 selector（加第 6 個 layer 就全部移位，令 imagery/3D 三個 check 㩒錯掣而假失敗）→ 改為**按 label 揀**；「十三個 panel」硬編 → 由 app 讀返。

### ✅ D5 完成（風羽方案，零新依賴）
- **決定（Cyrus 2026-09-23）**：用 MapLibre 原生 symbol 層畫**風羽**，**唔加** `geoql/maplibre-gl-wind`。
  - 理由：風羽係標準氣象符號（風桿 + 尾羽，半羽 5kt／全羽 10kt），零新 runtime dependency；而且呢個圖層嘅精度**本來就受測站位置限制**，粒子流動反而會遮住呢個限制。
- 落地：`BARB_BUCKETS` 9 個速度桶 → 每個桶註冊一張圖 → `icon-image` 用 `concat` **逐個 feature 揀圖**（專案第一個 data-driven icon）。
- **誠實規則用 data 兌現，唔係靠 styling**：每個 feature 帶一個 `fade`（由「最近有讀數測站」嘅距離算出），用 `icon-opacity` 套用；超過 ~15km 嘅格點**根本唔會產生**。
  - 實測：30 支風羽 · 最遠測站 **14.1km** · fade 由 **0.06 到 1.0**（30 個唔同值）。
  - Harness 新增兩個 check 鎖住呢條規則：改大 radius 或者移除 fade property 會**直接 FAIL**，唔會靜靜喺無站嘅海面畫風。
- 睇圖捉到兩個問題（DOM check 捉唔到）：
  1. `icon-size` 0.5–0.95 嗰陣風羽係睇唔到嘅小點。**尾羽就係資訊**，數唔到就只係裝飾 → 改成 0.7–1.35，加深色外框 + 亮色內線。
  2. 插值風速 < 2 km/h 會畫一個冇尾羽嘅光點——純噪音。**靜風用「冇嘢」表達**比用一堆點好。
- Panel 唔靠估：照樣報短缺（19/30 有風數據、11 個冇風向、2 個冇座標所以唔畫）。

### ⏳ 未開工
D3（Tier 0/1）、D4（Tier 2）、D6（Tier 3/4）、D7（AIS/TomTom/RFZ — 全部等 Cyrus 決定）。
另：氣象站圖層（`hko_stations_network`，`station-wind` glyph 已備）可以隨時加，但同風場圖層有重疊，建議併入 D5 之後再諗。

---

## PART F — D3/D4/D6 完成紀錄（2026-09-23）

**全部 Tier 0–4 已落地並且上咗畫面**，`analytics.test.ts` 8 組斷言、harness **61 項**全綠。

| 層 | 檔案 | 做咗乜 |
|---|---|---|
| Tier 0 | `analytics/baseline.ts` | signal × hour × dow 分桶（每訊號 168 桶），running n/sum/sumSq/min/max |
| Tier 1 | `analytics/rules.ts` + `data/rules.json` | 12 條規則、5 個領域，封閉 op 集 |
| Tier 2 | `analytics/convergence.ts` | 同區 + 60 分鐘定窗 + ≥2 領域，score = 領域×3 + 嚴重×2 + 宗數 |
| Tier 3/4 | `analytics/narrative.ts` | 範本敘述（**主要路徑**）＋ LLM prompt（離線跑） |
| 編排 | `analytics/index.ts` | 唯一接駁點；`updateBaselines()` 只折有意義嘅連續值 |

### 關鍵設計：閘要做成「唔可能忘記」

- `baselineFor()` 未夠 14 日係**回 null**，唔係回 baseline 加個 flag。咁樣呼叫者**物理上計唔到**異常分數——分別在於「規則要記得檢查」同「規則冇得唔記得」。
- 數**唔同日子**，唔係數觀測次數。500 次同一日嘅 poll 仍然只算 1 日，唔可以用一個下午扮成熟。
- **缺值唔等於 0**。折 0 會拉低基線均值，下一次正常讀數就變成「異常」——一個純粹由量度行為製造出嚟嘅假異常。已直接寫成斷言。
- 規則讀唔到值係 **skip**，唔係當 0。否則 `>= 0` 類規則會喺每個未回應嘅源上面觸發。

### 措辭：同時發生，唔講因為

`describeConvergence()` 係**唯一**嘅措辭函數，出「同一時段內同時發生」。單元測試同 harness 都**逐個字檢查**因果詞（因為／導致／造成／because／caused／due to），所以將來有人改範本都會喺 CI 撞板，唔係等到睇圖才發現。

### 要記低嘅兩個錯

1. **`rules.json` 出咗街但 app 載入 0 條規則。** `sync-data.mjs` 用**手寫清單**複製 registry 檔案，新檔案冇加落去。管線照跑、靜靜哋乜都唔出。已加 harness check 斷言規則真係載入到。
2. **Tier 0 分桶測試喺未夠 14 日嘅 store 上面斷言 baseline**，即係乜都冇斷言到——直到佢失敗為止。教訓：Tier 0 測試要先滿足 Tier 0 閘，否則測唔到嘢。

### 實測畫面

AE 輪候 panel 顯示廣華醫院 **2 小時**，規則引擎獨立報 `讀數 120（門檻 120）` rule `ae_wait_long`——兩者讀同一份數據，證明規則同顯示唔會各講各。

### 仲未做（要 Cyrus 決定）
- **AIS 船**：接受「Cron Trigger 每 N 分鐘收 30–60 秒」？定先用海事處抵港／離港頂住？
- **TomTom**：申唔申請？（**切記唔好加信用卡**）
- **RFZ 禁飛區**：係唔係指 eSUA 個「匯出」掣？需要你人手匯出 GeoJSON。
- **baselines 持久化**：而家 store 只喺 session 內存在，所以永遠顯示「累積中 0/14 日」。要真正有基線就要一個 cron collector 寫 `data/baselines.json`。**呢個係分析層由「有得睇」變成「有用」嘅關鍵一步**。

---

## PART E — 驗收（每項都要）

- `npm run typecheck` 0 錯、`npm test` 全 PASS、`python scripts/validate_config.py` exit 0
- `node scripts/verify-browser.mjs` 全 PASS（新功能要加 check）
- `node scripts/capture-v3.mjs` → **用 vision 親眼睇一次**（DOM check 捉唔到視覺問題——v0.2.3 就係靠睇圖捉到 5 個）
- 冇 key 入 bundle；冇 metered 源；runtime 冇 LLM
