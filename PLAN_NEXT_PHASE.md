# PLAN_NEXT_PHASE.md — 下一階段計劃

> 2026-09-23 晚。由 DSH 寫，基於**實測**（DOM + payload），唔係靠讀文件。
> 前一份：`WORK_ORDER.md`（VPS 側寫）、`HANDOVER.md`（交接）。
> 呢份係**修訂版**：WORK_ORDER 有幾項已經過時或者量錯，下面逐項講清楚。

---

## 0. 我今次做咗乜（已 commit）

| commit | 做咗乜 | 證據 |
|---|---|---|
| `83d71af` | CSDI 分區名含 CRLF → 修好；`parseWsd` 一行被 CRLF 斬開而靜靜哋掉咗記錄 → 修好 | parsers.test 新增 3 個斷言 |
| `ddf68db` | LAYERS 控制列出**rail 圖層**（之前總覽係 hidden + 0 行）；toggle 統一由 rail 掣做 | harness 新增 2 項，63/63 綠兩次 |

**Gates**：`tsc` 0 錯 · 5/5 test suites · `validate_config.py` exit 0 · **harness 63/63**（由 61 升）。

### 兩個真 bug（唔係文件講嘅，係量出嚟嘅）

1. **上游 CSDI 分區名帶 CRLF** —— `"深水埗區\r\n"`（feature OBJECTID 6，實測）。
   所有比對都係**字串全等**，所以一宗叫「深水埗區」嘅停水通知**永遠唔會**令嗰區變紅。
   同時 `parseWsd` 用 `\r?\n` 拆行，欄位內嘅 CRLF 會**將一行斬成兩行**，兩行都过唔到
   15 欄檢查 → **記錄靜靜哋消失**。兩個都修好，而且加咗測試鎖住。

2. **LAYERS 控制只列 vertical 圖層** —— 總覽模式 `hidden=true, rows=0`；
   喺 rail 開咗風場之後，個控制仲係只顯示「停水受影響地區」。
   即係用戶喺 rail 開嘅圖層，**喺地圖自己嘅控制度見唔到、熄唔到**。

### 順手修好 4 個量錯嘅 harness check

`querySourceFeatures` **只會回傳當前視窗已載入 tile 嘅 feature**（Pitfall 7）。
四項 check 讀佢當係「資料總數」，所以係喺度斷言**鏡頭位置**唔係資料：
風場報 0 支但 source 有 8 支、toggle 明明開咗。全部改讀 source GeoJSON。

---

## 1. WORK_ORDER 嘅修正（唔好照跟）

| WORK_ORDER 講 | 實測 | 判斷 |
|---|---|---|
| §2.2「查 LAYERS 為何唔顯示」 | 已查清楚並修好 | ✅ 完成 |
| §4「23 個 panel 嘅 group 全部空白，要填」 | **tabs 由 SOURCE 嘅 group 派生**（`main.ts` L334 `registry.byId.get(panel.source)?.group`），正確設計 | ❌ 過時，panel.group 唔應該填 |
| §2.1「兩欄 panels 已完成」 | 成立 | ✅ |
| §1.5.2「VITE_WORKER_BASE 冇文檔」 | 已有 `.env.example` + AGENTS.md Pitfall 17 | ✅ 已做 |
| §5 表 #1「資料過期只由一個源驅動」 | 已改為系統級（`N 個源出錯/過期`），DOM 實測 `1 個源過期` | ✅ 已做 |
| §5 表 #2「rail layer id 同 layers.json 對唔上，icon 變地球」 | **唔成立**：rail 6 個圖層 icon 全部唔同，只有**模式**（總覽／停水）用 fallback icon，而嗰兩個本來就應該用 `ICONS[id]` | ❌ 量錯 |
| §5 表 #3 baseline 永遠 0/14 | 收集器已寫，`data/baselines.json` 有 4 個 signal、各 **1 日** | 🟡 要做 §0.6 排程 |

**結論**：WORK_ORDER §4 同 §5#2 唔使做。真做嘅係 §0.5（Cyrus 兩步）、§0.6（排程）、§3（交通面板）、§6（orphan 源）。

---

## 2. 建議次序（每批做完跑 gate + harness + commit）

### P1 — 收尾（唔靠 Cyrus，今日做得完）

**P1.1 stale panel 要逐個分辨「源真係慢」定「cadence 填錯」**
實測（2026-09-23 晚，20 個 panel）：

```
OVERVIEW (19): live_cams_wall:live warnings_list:live breaking_news_list:STALE
  aircraft_status:live wind_status:live stations_status:live cameras_wall:live
  hko_cameras_wall:live special_traffic_list:STALE mtr_next_train_list:live
  kmb_eta_table:live tp_queue_grid:live hk_market_table:STALE crypto_prices:live
  aqhi_gauge_grid:live carpark_vacancy_list:live ae_waiting_grid:live
  analysis_brief:live water_suspension_list:STALE

TYPHOON (6): warnings_list:live tc_track_image:STALE rain_nowcast_map:live
  flight_table:live radar_image:live special_traffic_list:STALE
```

4 個 stale 之中，`breaking_news_list` 之前量到 26 小時舊 —— 政府新聞網係即時 feed，
26 小時唔更新**唔正常**。要逐個查：讀 `sources.json` 嘅 `cadence` vs 實際 payload 時間戳。
🔴 唔准為了「令佢變綠」而調鬆 cadence —— 假 live 比 stale 更差。

**P1.2 105 個 orphan 源仍然冇面板**（175 declared → 用咗約 30）
`WORK_ORDER §6` 分批建議仍然有效。**由 B5.1（weather 15 個）開始**，因為 HKO 基礎已有。
每個 panel = parser + adapter + panels.json 三件，跟 `SPEC_TRANSPORT_PANELS.md` 形狀。
🔴 唔可以一次做：每批跑 harness，確認冇拖跌其他 panel。

**P1.3 `station-wind` 同風場圖層視覺重疊**
兩個圖層同時開會重疊。風羽已經編碼風速，測站點只加位置。
→ 建議：測站圖層預設**關**，或者縮到只在 zoom ≥ 12 顯示。

### P2 — 要 Cyrus 先做（唔好等，但冇咗做唔到）

| # | 要乜 | 解鎖 |
|---|---|---|
| 1 | `npx wrangler login` + `deploy` | **103/175 (59%) 個 proxy 源** |
| 2 | aisstream.io 免費 key → `C:\Users\cyrus\.aisstream_key` | 船舶圖層 |
| 3 | 每小時排程跑 `collect_baselines.mjs`（WORK_ORDER §0.6） | 14 日後基線類事件 |
| 4 | **P0-6：新聞政治內容** —— 只有你可以決定 | 見下 |

**P0-6 係產品定位決定，唔係技術問題。** 現時 ticker 同 `breaking_news_list` 用
`gov_news_law_order`（政府新聞網治安分類）。公開之後收唔返。
三個選項：(a) 保留（官方治安消息）；(b) 換做純交通／天氣；
(c) 保留但加明確「只轉載官方原文、不代表本項目立場」聲明。**要你揀。**

### P3 — 工程改進（唔急但值得）

**P3.1 `querySourceFeatures` 呢個陷阱要制度化**
今次同上次（aircraft）都栽喺同一件事。建議喺 harness 開頭加一個 helper
`sourceFeatures(map, id)`，所有 layer check 一律用佢，就唔會再有人手寫錯。

**P3.2 panel 狀態嘅 stale 判定要審一次**
`degrade()` 用 `cadenceSeconds(cadence) × 2`。實測有 panel 長時間 stale
（`breaking_news_list` 26 小時、`special_traffic_list` 亦然）。
要分辨：源真係停更新（誠實），定係 cadence 填錯（假 stale）。

**P3.3 attribution 覆蓋**
`ATTRIBUTION.md` 由 `build_attribution.py` 生成。加面板時要確認新源有入去。
10 個源冇 license —— **唔准亂填**（錯嘅授權比冇更差），要逐個讀條款。

---

## 3. 驗收（每批）

```powershell
cd C:\hk-city-monitor\web
npx tsc --noEmit
npm test
set VITE_WORKER_BASE=http://localhost:8787&& npm run build
node scripts/verify-browser.mjs http://localhost:4173/     # 現時 63 項，唔可以跌
```
另加：`python scripts/validate_config.py` exit 0。

**UI 改動唔准靠截圖判斷**（Pitfall 16）—— 用 DOM 讀 `window.__hkcm` / `window.__map`。

---

## 4. 我**冇**做嘅嘢（唔好當做咗）

- 冇部署 Worker（要 `wrangler login`，得 Cyrus 做）
- 冇填 10 個空白 license（錯嘅授權比冇更差）
- 冇改 `ATTRIBUTION.md`（生成檔）
- 冇加第 9 個 render kind
- 冇加新 npm dependency
- 冇郁 `legacy/index.html`

---

*2026-09-23 · 所有數字由本機 DOM／payload 實測*
