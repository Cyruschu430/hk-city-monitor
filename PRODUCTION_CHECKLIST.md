# PRODUCTION_CHECKLIST.md — HK City Monitor

> 目標：**推到 public + host 到 production，然後慢慢改 UIUX。**
> 呢份係「公開最低門檻」，唔係 feature list。每項寫明：現況（實測）／位置／要改咩／點驗證／紅線。
>
> 執行：DSH 照做 → VPS 側驗證（截圖 + DOM audit，唔靠自報）

---

## 0. 先講三個唔明顯嘅事實（實測 2026-09-23）

1. **「資料過期」只由一個源驅動** —— 唔係全域狀態。
2. **rail 嘅 layer id 同 `data/layers.json` 對唔上** —— 可能令 toggle 靜靜哋失效。
3. **好多「未做」嘅嘢其實已經做咗**：`palette.ts`（⌘K）、`statusbar.setCoverage()`、`honesty.ts`（4 態新鮮度）、`drawer.ts`、`focushud.ts` 全部存在。
   → 所以呢份清單大部分係**修正 + 呈現**，唔係新建。

---

## P0 — 公開前必須（blocking）

### P0-1 資料過期語意：label 通用，條件單一

**實測**（`web/src/main.ts` L195–205）：
```ts
const emit = (sourceId, value) => {
  if (sourceId === "wsd_water_suspension") {          // ← 只此一個源
    const fresh = value?.records_fresh ?? [];
    const recs  = value?.records ?? [];
    if (recs.length > 0 && fresh.length > 0) setFreshness("資料新鮮", "ok");
    else if (recs.length > 0)                setFreshness("資料過期", "stale");  // ← 真正意思
    else                                     setFreshness("無事件", "ok");
  }
}
```
**「資料過期」真正意思 = 有停水記錄，但冇一條通過 30 分鐘新鮮度門檻。**
同 171 個源、同其他 panel 完全無關。

**問題**：用戶（同你自己）見到「狀態：資料過期」會以為成個 dashboard 嘅資料都舊 —— 實際上淨係水務署一個源。

**要改**
- `statusbar.ts` 嘅 `setFreshness` 介面註解本身寫「readout for the currently active vertical's data age」→ 照呢個原意做：**每個 vertical 一個 freshness cell**，唔係硬綁一個源
- 用 `honesty.ts` 嘅 `degrade(h, cadenceSeconds)`（已有）為**每個源**算狀態
- 頂欄顯示 **「N 個源過期」**，可點開列出**源名 + 年齡**

**驗證**：故意令一個源 stale → 頂欄顯示**該源名稱**，唔係「資料過期」四個字。

---

### P0-2 rail layer id 對唔上（可能係壞 toggle）

**實測**
```
data/layers.json 實際 id ：
  cameras_all, hko_cameras, rain_nowcast, ae_hospitals,
  water_suspension, water_suspension_districts,
  aircraft, wind_field, weather_stations          （9 個）

web/src/ui/rail.ts 嘅 LAYER_ICONS key ：
  cameras_td, cameras_hko, rain_nowcast, imagery,
  buildings3d, aircraft, wind_field               （7 個）

對唔上：cameras_td / cameras_hko / imagery / buildings3d
```
**後果**（`rail.ts` L102）：
```ts
icon(LAYER_ICONS[l.id] ?? ICONS["overview"]!)   // ← 缺 icon 靜靜哋變地球圖標
```
`rail.ts` 自己嘅檔頭註解寫 *"Verticals are DATA: this file renders whatever verticals.json contains"* —— 但 **`LAYER_ICONS` 係硬寫**，所以 layer 唔係 data-driven。

**要改**
- 統一 id（`cameras_td → cameras_all`、`cameras_hko → hko_cameras`；`imagery`/`buildings3d` 決定係加落 layers.json 定係由 rail 移除）
- rail 由 `layers.json` 驅動；`LAYER_ICONS` 只做 icon lookup，**缺失時喺 dev 模式報錯**（唔好靜靜哋 fallback）

**驗證**：每個 toggle 撳一次 → 地圖有反應 + console 零 warning + localStorage 記錄正確。

---

### P0-3 `sources_report.json` 新鮮度

**實測**：`probed_at: 2026-09-18T21:19:12+0800` → **5 日前**
```
ok: 162 ／ needs-params: 3 ／ unprobeable: 3 ／ fail: 3 ／ TOTAL: 171
```
**要改**：加 collector（cron 定時重跑 probe）→ 寫入 `data/sources_report.json`
**驗證**：`probed_at` 年齡 < 設定門檻；3 個 `fail` 要處理（修 URL 或標明）。

---

### P0-4 「171 個源」要呈現得清（呢個就係你嘅疑問）

**實測**：`statusbar.ts` **已經有** `setCoverage({live, total, error, stale, catalog})`，而且介面註解寫：
> *"what fraction of the catalog is actually on screen and working right now. **Numbers must come from runtime, never a literal.**"*

**現況**：171 條 probed，但 UI 只呈現 **9 layers + ~22 panels** → 你「感覺冇咁多」係對嘅觀察。

**要改**：令 coverage 讀數明顯（例：`171 源 / 162 live / 3 stale / 3 error`），或者加一個 `/sources` 頁列出全部 171 條：名稱、類別、licence、最後更新、狀態。
**驗證**：頁面數字同 `sources_report.json` 對得上（唔可以係硬寫）。

---

### P0-5 baseline persistence（DSH 自己喺 commit 指出）

**現況**（commit e2fa015 原文）：baseline store 係 in-memory → 永遠顯示「累積中 0/14 日」。
**要改**：cron collector 寫 `data/baselines.json`；前端讀檔而非記憶體。
**驗證**：重開 app 後 0/14 **會遞增**（唔係 reset）。

---

### P0-6 新聞 feed 類別（紅線，唔係技術問題）

**實測**：`breaking_news_list` 出政府新聞網「治安 · 法治」分類 → 實際內容為政治／國安相關（黎智英案、歐盟報告、江學禮任命）。
**你自己 `AGENTS.md` 寫死**：
> *"Political security / national-security content: **none**"*
> *"never publish political or national-security content"*

**要改**（你揀）：收窄類別（交通／天氣／民生）／加明確來源標註／或者移除。
**紅線檢查**：公開 repo + AGPL = 收唔返。**呢項一定要你本人決定。**

---

### P0-7 README / LICENSE / ATTRIBUTION 完整

**已有** ✅：每個 source 有 **licence field**（commit e3167b0 記錄 165 條）—— 做得好。
**要加**：`LICENSE`（AGPL-3.0）、`README.md`（what / how to run / 資料來源 / 免責）、`ATTRIBUTION.md`（或 `/sources` 頁）。
**驗證**：公開 repo 首頁睇得到；171 條來源全部可追。

---

## P1 — Production grade（公開後即刻做）

### P1-1 Sidebar 可讀性：12 個 icon 要一眼睇明
**實測**：`rail.ts` = **5 個模式** + **7 個圖層開關**，只有 hover `.tip`（`name · title`）
```
模式：overview 總覽 / typhoon 颱風 / border 口岸 / water_supply 停水 / leave 假期
圖層：cameras_td / cameras_hko / rain_nowcast / imagery / buildings3d / aircraft / wind_field
```
**要改**：分組標題（模式 / 圖層）+ 常駐 label 或 hover 展開；參考 World Monitor 嘅 `layer-explain`（每個 layer 一句解釋）。
**驗證**：新用戶唔使 hover 都講得出每個 icon 係咩。

### P1-2 Layer 三同步（世界級標準）
World Monitor 明文要求：toggle 一個 layer 必須**同時**改三樣
```
control state  +  ?layers= URL（可分享）  +  localStorage（下次記得）
```
**要驗**：`?layers=` 係唔係已經存在（`main.ts` 未確認）。
**驗證**：toggle → URL 更新 → 重開仲記得。

### P1-3 `palette.ts` 已經存在 → 檢查完整性
⌘K 要 jump 得到 **layer / panel / mode** 三類。

---

## P2 — UIUX（慢慢改，公開後）

| 項目 | 現況 |
|---|---|
| Panel toggle + localStorage persist | `panels.json` 有 `_renders`；要加 toggle |
| Panel drag-drop | **等 panel 數量 > 12 才做**（World Monitor 44 個 panel 才需要） |
| 飛機定向 symbology + 加 `ais`（船） | `web/src/map/symbols.ts` 已存在，欠定向 |
| Charts（HKMA 數據） | 未做；HKMA Open API 官方明文免費、免註冊 |
| LLM Brief | 用 **slot + latest pointer** 純靜態 `data/brief/<slot>.json` + `latest.json`；生成用**本地 Ollama 優先**（零 key 零 token） |
| `?layers=` / Sources 頁 | 見 P0-4 |

**唔好做**：Cesium、Mapbox（metered）、HKEX 即時行情（US$60k license）、runtime LLM。

---

## ⚠️ 驗證方法（呢個影響你點 review）

World Monitor 踩過嘅坑（官方 verification skill 原文）：
> *"`MapContainer.hasWebGLSupport()` explicitly rejects a `swiftshader` / `llvmpipe` / `software rasterizer` renderer string, so headless Chromium **always** lands on the SVG map... Only a headed run with real GPU GL mounts deck.gl."*

**即係：headless 截圖 = 唔一定係 deck.gl 路徑。** 要驗 deck.gl / 3D 就必須 **真 GPU headed run**。

**截圖做證據**（每個 state 一張）：
```
01-on.png ／ 02-off.png ／ 03-restored.png
```
**而且**：同一個 toggle 喺唔同 renderer 係**唔同 DOM 元素**（SVG 用 `button.layer-toggle` + `active` class；deck.gl 用 `<input type=checkbox>` + `checked`）。讀錯 renderer → 讀到 `null`。

---

## 建議次序

```
P0-1 資料過期語意        ← 1 個源驅動全域 label，最誤導
P0-2 rail id 對唔上      ← 可能係壞 toggle
P0-6 新聞類別（你決定）  ← 紅線，公開前一定
P0-5 baseline persistence
P0-3 sources_report 新鮮度
P0-4 coverage 呈現（回答 171 源）
P0-7 README / LICENSE / ATTRIBUTION
→ 公開 + host（Cloudflare Pages + Worker）
→ P1 → P2
```

---

*產出：2026-09-23 · 由 VPS 側實測（讀你部機嘅檔案，未改任何嘢）*
