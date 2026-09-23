# WORK_ORDER.md — HK City Monitor 完整工作單

> 2026-09-23。涵蓋**全部**討論過嘅事項，唔准做少少就算。
> 每項：現況（實測）／改咩／邊個檔案／點驗證。
>
> **執行者：DSH**。驗證者：VPS 側（截圖 + DOM audit，唔靠自報）。

---

## 0.6 Baseline collector —— 要你設一次排程（agent 做唔到）

`scripts/collect_baselines.mjs` 已經寫好並實測（4 個 signal 全部拿到真值，
`data/baselines.json` 已生成，app 由 `0/14` 變 `1/14` 日）。**但要有人定時跑佢。**

### 為咩要每小時跑，唔係每日
`baseline.ts` 用 `(day-of-week, hour-of-day)` 分桶 —— 每個 signal 7×24 = 168 個桶。
每日跑一次只會填 1/24 個鐘數嘅桶，其他鐘數搵唔到 baseline，規則會永遠 immature。
每小時跑 = 每日 24 個桶、14 日就夠，成本係每日 96 次免 key fetch。

### 設定（Windows 工作排程器，每小時）
```
node C:\hk-city-monitor\scripts\collect_baselines.mjs
```
跟住（要出街先要推上去，因為 Pages 由 git 部署）：
```
git -C C:\hk-city-monitor add data/baselines.json
git -C C:\hk-city-monitor commit -m "chore(data): hourly baseline collection"
git -C C:\hk-city-monitor push
```
⚠️ 只 `add data/baselines.json` —— 唔好 `git add -A`，會夾埋其他未 ready 嘅改動。

### 驗證
```
node scripts/collect_baselines.mjs --dry-run
```
應該見到 4 行 signal + `X/14 days`。第一次跑會寫檔；同日再跑會改變（第二個樣本
refine 同一小時嘅桶），但 `days` 唔會增加 —— 14 日 gate 數嘅係**日數**，唔係樣本數。

### 唔好做
- ❌ 唔好改 `data/baselines.json` 嘅 `version`（app 會拒絕載入並用空 store）
- ❌ 唔好刪 `data/baselines.json` 入 git（`sync-data.mjs` 會警告但唔會爆，
  app 會退回「累積中 0/14 日」—— 誠實但無用）

## 0.5 只有 Cyrus 可以做嘅兩步（agent 做唔到，唔好等）

呢兩步要瀏覽器授權／註冊，agent 冇辦法代做。未做之前以下工作**唔會完成**：

1. **Cloudflare 登入**（解鎖 Worker 部署 → 解鎖 103/175 個 proxy 源）
   ```
   cd C:\hk-city-monitor\worker
   npx wrangler login
   ```
   登入後：`npx wrangler deploy`。
   驗證：`curl "https://<worker>.workers.dev/proxy?url=<一個 proxy 源 url>"` 要 HTTP 200。

2. **AISStream 免費 key**（解鎖船舶圖層）
   - `aisstream.io/account` → 用 GitHub 登入 → Create key
   - 寫入 `C:\Users\cyrus\.aisstream_key`（**唔好**貼公開頻道、唔好 commit）
   - 官方條款：*"The API key belongs in a server-side environment variable"* → **唔可以放前端**
   - Collector 已寫好：VPS `/home/admin/ais/ais_collector.py`（自檢 + WS transport 已測通）

**唔使做**：`airplanes_live`（已知 403，已用 adsb.lol 代替）；MTR／九巴／HKMA／YouTube／Google Maps 全部免 key。

## 0. 已完成（唔使做）

| 項 | 狀態 |
|---|---|
| `data/live_streams.json` 16 → **18 條**（RTHK + HOY TV，實測 live） | ✅ 已做，backup 在 `.bak-20260923` |

---

## 1. 人手準備（只有 2 樣，其餘 169/175 唔使）

**實測 `auth` 分佈**：
```
auth=none      169  ✅ 唔使做任何嘢
auth=free-key    4  ← 要免費 key
auth=register    2  ← 1 個可選、1 個廢
```

### 🔑 要準備
1. **AISStream 免費 key**（唯一真免費 live AIS）
   - `https://aisstream.io` — GitHub 登入，免費
   - 用途：船隻（marine group）
   - ⚠️ 誠實註記（你自己 sources.json 寫嘅）：陸基接收站為主，遠洋船可能收唔到
2. **open3dhk 免費 key**（**一個 key 開 3 條源**）
   - `https://data.map.gov.hk` — 3D 建築物 / 基礎設施 / 網格模型（3D Tiles，全部已驗證 200）
   - 只做 3D 功能先要；唔做 3D 可以唔拿

### ⏭️ 可選
3. **OpenSky 免費帳號** — 匿名都用得，只係 rate limit 低

### ❌ 唔使理
- `airplanes_live` — **已知返 403**，已用 adsb.lol / adsb.fi 代替。唔好再試
- YouTube / MTR / 九巴 / HKMA / data.gov.hk — **全部零 key**（已實測）

### 🧑 只有你本人可以決定
- **P0-6 新聞政治內容**（見 §5）—— 公開之後收唔返

---

## 1.5 P0（2026-09-23 實測發現，最優先）

### 1.5.1 Worker 未部署 = 59% 源冇得用

```
sources.json fetch 分佈：proxy 103 / browser 67 / n/a 5   （共 175）
```
`worker/wrangler.toml` 自己寫明：
> CORS proxy for the sources.json entries whose "fetch" is "proxy" (102 of 171)

同一檔案明文：
> DO NOT add account_id or routes here: deployment is out of scope for the overnight run

**實測**：本機 `wrangler dev` 喺 8787 通（`hko_webcam` → HTTP 200，真 JPEG；`hko_webcam_index` → HTTP 200）。
**後果**：一旦部署到 production，103 個源全部失敗。
**要做**：`cd worker && npx wrangler deploy`（Cloudflare 免費層；要 account_id）。
**驗證**：`curl "https://<worker>.workers.dev/proxy?url=<hko_webcam 條 url>"` 要 HTTP 200。

### 1.5.2 VITE_WORKER_BASE 冇文檔 → build 唔可重現

`web/src/config.ts` L2 明文：`VITE_WORKER_BASE is a BUILD-TIME value (Vite inlines VITE_*)`。
**冇 `web/.env`、冇 `.env.example`、冇任何 .md 提過。**
**實測後果**：唔帶呢個 var 跑一次 `npm run build`，7 個 panel 由有真數據變「未能讀取數據 — 需要 Worker 代理」，
覆蓋由 13/16 跌到 8/16。

正確 build：
```
cd web && set VITE_WORKER_BASE=http://localhost:8787&& npm run build
```
**要做**：加 `web/.env.example`（`VITE_WORKER_BASE=https://<worker>.workers.dev`）+ README 寫明係 build-time。
**驗證**：`Select-String web/dist/assets/*.js -Pattern 'localhost:8787'` 至少 1 個 match。

---

## 2. 批次 1 — 版面（最快見到效果）

### 2.1 兩欄 panels（已完成，2026-09-23 實測 PASS）

```css
/* web/src/styles/app.css */
#layout{grid-template-columns:56px 1fr minmax(340px,44%)}
#panels{overflow-y:auto;overscroll-behavior:contain;border-left:1px solid var(--hairline);
  background:linear-gradient(180deg,rgba(9,15,26,.9),rgba(6,10,18,.94));
  padding:12px;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);
  align-content:start;gap:10px}
.panel{...原有...;min-width:0}
@media (max-width:880px){ #panels{grid-template-columns:1fr} }
```

**實測結果（CDP，1440×1200）**：
```
display: grid
gridTemplateColumns: "295.297px 295.297px"   ← 平均兩欄
columns: 2 ｜ panelWidths: [295]
maxRight: 1420（盒右邊 1440）→ overflowRight 0
offScreen: 0 ｜ panelsWithInnerOverflow: 0
```

⚠️ **兩個失敗過嘅做法，唔准再用：**

1. **`#panels{column-count:2}` + `display:flex`** → **無效**。CSS multicol 喺 flex 容器上完全唔生效。
   實測：17 個 panel 全部 left=810，effectiveColumns=1。

2. **`#panels{column-count:2}` + `display:block`（#panels 有固定高度）** → **內容飛出螢幕**。
   CSS multicol 遇上**固定高度**會**橫向長出新欄**去裝內容。
   實測：5 欄，left = 810/1116/1422/1728/2034，而盒只 627px 闊 → 後三欄喺 1440px 螢幕外。

3. **`grid-template-columns:1fr 1fr`** → 欄縮唔到（`1fr` = `minmax(auto,1fr)`，grid item 嘅 auto 最小 = min-content）。
   實測：欄闊 614px + 380px = 994px 塞入 634px 盒 → 第二欄 left=1444（螢幕 1440）→ 出界。

**正確做法 = `minmax(0,1fr)`**（令欄可以縮）+ `.panel{min-width:0}`。

### 2.2 查 LAYERS 為何唔顯示（**查，唔好重寫**）
```
web/src/ui/layercontrol.ts                          ← 已建好（checkbox + glyph + 大寫名 + ⓘ + expand）
main.ts L136  const layerEl = h("div", { class: "layer-control" });
main.ts L137  hudEl.append(layerEl);                ← 已接線
main.ts L175  layerControl.setRows(rows);
app.css L78   .layer-control{position:absolute;left:10px;bottom:52px;...}
app.css L81   .layer-control[hidden]{display:none}  ← 嫌疑
```
**要查**：邊個 code path 設 `hidden`？係唔係 `setRows([])` 就自動隱藏？
🔴 **唔准重寫 `layercontrol.ts`** —— 佢已經做對，檔頭明文解釋「只改可見性、唔改 mode 決定可用性」嘅合約。

### 2.3 圖例（legend）
- `symbols.ts` 已有 bucket table（wind barb），註解提到 *"without a legend lookup"*
- **先確認唔同 LAYERS 面板嘅 ⓘ 重複** —— 圖例只做**語義**（顏色 = 風險級別），唔做圖層清單

---

## 3. 批次 2 — 交通面板（spec 已寫，見 `SPEC_TRANSPORT_PANELS.md`）

已驗證 payload（唔使再查）：

| 面板 | API | 實測 |
|---|---|---|
| **MTR 下一班車** | `rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=ISL&sta=ADM` | UP/DOWN 各 4 班，`ttnt` = 分鐘；時間格式 `"YYYY-MM-DD HH:mm:ss"`（無 T！） |
| **九巴到站** | `data.etabus.gov.hk/v1/transport/kmb/stop-eta/{stop_id}` | 一次返晒成個站所有路線；`rmk_tc` = 備註 |
| **城巴／新大嶼山** | `rt.data.gov.hk/v1/transport/batch/stop-eta` | ⚠️ 要 POST body（`todo: true`） |
| **龍運** | `lwb_eta` | 同九巴同款 |
| **綠色小巴** | `data.etagmb.gov.hk` | 已驗證路徑 |
| **渡輪** ×3 | `sunferry_eta` / `hkkf_eta` / `mardep_crossboundary_ferry` | — |

**每加一個 panel = 3 個檔案**（跟 spec 寫嘅形狀）：
```
a) web/src/lib/parsers.ts     + parseXxx()   ← pure function，return items/rows + observedAt
b) web/src/lib/adapters.ts    + ADAPTERS.xxx = async (src, panel) => {...}
c) data/panels.json           + panel 條目（render 只可用 8 個 kind 之一）
```
🔴 **`adapters.ts` 檔頭明文**：adapter 只可以 **return 或 throw** —— 唔可以回 0／空／猜。
🔴 **`rmk`（備註）必須顯示** —— 九巴返「原定班次」= 推算唔係 GPS，唔顯示就違反 honesty。
🔴 **唔做「巴士位置推算」當實時** —— 官方開放數據**冇車輛座標**（三個 API spec 都查過）。

---

## 4. 批次 3 — Tab 分類

**實測**：
- `panels.json` 23 個 panel 嘅 `group` **全部空白**
- **冇任何 `.ts` 讀 `panel.group`** → 填咗冇反應，要同時加 tabs UI

**12 個 group 跟 `sources.json`（唔准自己發明）**：
```
weather 40 │ civic 40 │ transport 30 │ news 15 │ geospatial 13 │ prices 8
border 7 │ aviation 6 │ cameras 5 │ marine 5 │ market 3 │ global 3
```
1. 填 23 個 panel 嘅 `group`
2. `#panels` 頂加橫向 tab（可滾動，手機睇到）
3. 預設 tab = 總覽（= `main.ts` 現有 `OVERVIEW` 16 個）
4. tab 入 URL（`?tab=transport`）→ 同 layer 三同步一致

---

## 5. 批次 4 — 修 P0（見 `PRODUCTION_CHECKLIST.md` 詳版）

| # | 問題 | 位置 |
|---|---|---|
| 1 | **「資料過期」只由 `wsd_water_suspension` 一個源驅動**，label 通用 → 誤導 | `main.ts` L195-205 |
| 2 | **rail layer id 同 `layers.json` 對唔上**（`cameras_td` vs `cameras_all`、`imagery`/`buildings3d` 唔存在）→ `icon(LAYER_ICONS[l.id] ?? ICONS["overview"])` 靜靜哋變地球 | `rail.ts` L102 |
| 3 | **baseline in-memory → 永遠「累積中 0/14 日」**（DSH 自己 commit 指出） | `analytics/baseline.ts` |
| 4 | `sources_report.json` probed_at = **09-18（5 日前）** | `data/` |
| 5 | **171 條源但 UI 只呈現 9 layers + 23 panels** → coverage 要明顯 | `statusbar.setCoverage()` 已存在 |
| 6 | **10 條源冇 license**（165/175 有） | `sources.json` |
| 7 | README / LICENSE(AGPL) / ATTRIBUTION 未齊 | repo root |
| 8 | 🔴 **新聞 feed 出政治／國安內容**（`gov_news_law_order`）—— **只有你本人可決定** | `panels.json` `breaking_news_list` |

---

## 6. 批次 5 — 101 個未用嘅 native source（分批，唔可以一次做）

**實測**：
```
175 declared → USED 27 → ORPHAN 148
  ├ ck_*  : 47  ← CSDI 鏡像，22 個明確同 native 重複 → 合併，唔好每個做 panel
  └ native: 101 ← 真正覆蓋缺口
```

**orphan native 分佈**：
```
civic      27   康文署場地/活動/圖書館/博物館/沙灘/紅潮/ AED…
weather    15   hko_warninginfo / rhrread / tide / earthquake / aqhi…
news       14   RTHK ×5 / gov_news ×6 / gov_press / fsd_press…
transport  13   speedmap / journeytime / carpark / 城巴 / 龍運 / 小巴 / 渡輪…
geospatial 11   ⚠️ 呢啲唔係 panel —— 係 basemap/label/imagery tiles + 地址查詢
prices      8   油價 / 網購格價 / 嬰兒奶粉 / 投訴 / 車費 / 樓市…
border      4   深圳灣 / 香園圍 / 管制站
aviation    3   opensky / adsbdb（airplanes_live 廢）
global      3   USGS 地震 / NASA EONET / Open-Meteo
marine      2   aisstream（要 key）/ mardep_vessel_arrivals
market      1   yahoo_hsi
```

**分批建議**（每批做完驗證再做下一批）：
```
B5.1  weather 15    ← 已有 HKO 基礎，最易
B5.2  transport 13  ← 跟批次 2 同一模式
B5.3  news 14       ← ⚠️ 要先解決 §5.8 紅線
B5.4  civic 27      ← 最大，可再分 康文署 / 統計 / 其他
B5.5  prices 8 + border 4 + global 3 + market 1
B5.6  marine 2 + aviation 3   ← 要 AIS key
B5.7  geospatial 11 ← 唔係 panel，係地圖資源，單獨處理
```

**每批共通規則**：
- 1 個 source = 1 個 adapter + 1 個 panel 條目（除非係重複源 → 合併）
- `render` 只可用 8 個 kind（`render.ts` 明文：第 9 個係 spec 變更）
- 零新 npm dependency（`web/package.json` 而家只有 `maplibre-gl`）
- 每個 panel 要顯示 `cadence_note` + traceability footer

---

## 7. 全部共通紅線

```
❌ 唔加新 npm dependency
❌ 唔用 live_stream?channel=（已實測失敗）
❌ 唔重寫 layercontrol.ts / honesty.ts / render.ts（已經做對）
❌ 唔發明新 group 名（跟 sources.json 12 個）
❌ 唔加新 render kind（8 個封閉）
❌ 唔做車輛位置推算當實時（官方冇座標）
❌ 唔引入任何收費／metered host（Mapbox / Cesium ion / HKEX 行情）
✅ 每個 claim 要有數據來源（你 AGENTS.md 原則）
✅ 出處標明（175 條源全部有 license 欄位）
✅ stale 唔可以扮 live（honesty.ts 四態）
```

---

## 8. 驗證方式（每批做完）

```
1. node/web 測試：parsers.test.ts 加 assertion group
2. hasAdapter(sourceId) === true
3. 截圖：1440px + 375px
4. DOM audit：唔可以只靠肉眼
5. 故意令一個源 fail → 要出 error 態（唔可以空表）
```
**⚠️ 重要**：headless Chromium **永遠行 SVG renderer**（`hasWebGLSupport()` 拒絕 swiftshader）→ **驗 deck.gl 一定要真 GPU headed run**。

---

*2026-09-23 · 全部數字由 VPS 實測你部機*
