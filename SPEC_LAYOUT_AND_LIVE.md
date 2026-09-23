# SPEC — Layout / Live / Tabs（v2）

> 2026-09-23。目標：**做得好好睇睇**，用地圖＋多 panel 大屏。
> 全部經 VPS 實測你部機嘅 code 寫成，唔係猜。
>
> ⚠️ **呢份推翻我早前兩個建議** —— LAYERS 面板唔使建（已經有），直播唔可以用 channel embed。

---

## A. 加直播頻道（純 config，零 code）

`data/live_streams.json` 由 16 → 18 條：

```json
{ "id": "GxMB-EH_lJs",  "title": "香港電台 RTHK 直播", "channel": "RTHK 香港電台" },
{ "id": "gjN3_AIowt8",  "title": "HOY TV 直播",       "channel": "HOY 媒體網絡" }
```

**實測（2026-09-23）**：
```
https://i.ytimg.com/vi/GxMB-EH_lJs/hqdefault_live.jpg  → 200 ✅ 直播中（RTHK）
https://i.ytimg.com/vi/gjN3_AIowt8/hqdefault_live.jpg  → 200 ✅ 直播中（HOY）
```

⚠️ **唔可以靠 `live_stream?channel=`** —— 你 `web/src/lib/live.ts` 檔頭註解寫明：
> *"hardcoding a channel embed is a black rectangle most of the time (the live_stream?channel= pattern **failed every test**)"*

所以 `live_streams.json` 嘅 `id` **必須係 YouTube video ID**。

⚠️ **ID 會變**：RTHK/HOY 換一場直播，舊 ID 就唔再 live。呢個係你現有設計已處理嘅情況 ——
`probeLive()` 探 `hqdefault_live.jpg`，非 200 就顯示「現時無直播」。`cadence: "manual"` 係正確嘅（社群策展）。
**唔需要改任何 code。**

---

## B. 兩欄 panels（純 CSS，3 行）

實測現況 `app.css`：
```css
#layout{grid-template-columns:56px 1fr 340px}       /* panels 欄固定 340px */
#panels{overflow-y:auto}                            /* 單欄垂直滾動 */
@media (max-width:880px){ #layout{grid-template-columns:1fr} }  /* 你已有 breakpoint */
```

改成：
```css
#layout{grid-template-columns:56px 1fr minmax(340px,44%)}
#panels{column-count:2;column-gap:10px}
#panels .panel{break-inside:avoid;margin-bottom:10px}
@media (max-width:880px){ #panels{column-count:1} }
```

**為咩用 CSS multi-column 而唔用 grid？**
`grid-template-columns:1fr 1fr` 會將 panel 排成嚴格兩行 —— panel 高度唔同就會出現大空洞。
`column-count` 係**自然 packing**（似報紙分欄），零 JS、零 library、panel 唔會斷開（`break-inside:avoid`）。

**⚠️ 前提**：兩欄之後每欄約 340-380px。`params.max` 控制每個 panel 行數（現有機制），
World Monitor 嘅列表每個都係 3-4 行 —— 跟呢個密度。

---

## C. LAYERS 面板 —— 唔使建！已經存在，要查為何唔顯示

```
web/src/ui/layercontrol.ts     已建：checkbox + layer glyph + 大寫名 + ⓘ (來源/出處) + expand
main.ts L136  const layerEl = h("div", { class: "layer-control" });
main.ts L137  hudEl.append(layerEl);
main.ts L138  const layerControl = createLayerControl(layerEl, (row, on) => {...});
main.ts L175  layerControl.setRows(rows);
app.css L78   .layer-control{position:absolute;left:10px;bottom:52px;display:flex;flex-direction:column}
app.css L81   .layer-control[hidden]{display:none}       ← ⚠️ 嫌疑
```

`layercontrol.ts` 檔頭自己講明設計來源：
> *"Taken from a real World Monitor dashboard screenshot: its bottom-left has a checklist, one row per layer — checkbox, the layer's own little glyph, an upper-case name, an ⓘ (source / attribution) and an expand affordance."*
> *"Ours was a PASSIVE legend: it listed what happened to be drawn and could not be touched. ... a legend that only ever describes what the code chose to draw is not an instrument; it is a caption."*
> *"Toggling here changes VISIBILITY only. It never re-fetches and never mutates the mode's layer set."*

**要做嘅係查，唔係重寫：**
1. 邊個 code path 設 `.layer-control` 嘅 `hidden`？（grep `hidden` / `layerControl`）
2. 係唔係 `setRows([])` 空陣列就自動隱藏？
3. 截圖（1440px 闊）應該見到佢喺地圖左下 —— 冇見到 = hidden 生效緊

**如果係 hidden 條件太嚴 → 改條件。如果係冇 rows → 修 `currentLayerRows` 嘅建立時機。**
🔴 **唔可以重寫呢個檔案** —— 佢已經做對，重寫只會失去「只改可見性、唔改 mode 決定可用性」嘅合約。

---

## D. Tab 分類（`group`）—— 呢個係新功能，唔係 config

**實測**：
- `panels.json` 23 個 panel 嘅 `group` **全部空白**
- **冇任何 `.ts` 讀 `panel.group`**（唯一 hit 係 `convergence.ts` 一個無關嘅 `group.map`）

→ **填 `group` 唔會有任何效果，要同時加 tabs UI。**

**12 個 group 跟 `sources.json`（唔好自己發明）：**
```
weather 40 │ civic 40 │ transport 30 │ news 15 │ geospatial 13 │ prices 8
border 7 │ aviation 6 │ cameras 5 │ marine 5 │ market 3 │ global 3
```
（你猜嘅「康體／治安／醫療」三個都唔存在 —— 醫療數據收喺 `civic` 40 條裏面）

**做法（細）**：
1. 填 23 個 panel 嘅 `group`
2. `#panels` 頂加一排 tab（橫向、可滾動，手機都睇到）
3. 預設 tab = 總覽（即 `OVERVIEW` 而家嗰 16 個 panel）
4. tab 狀態入 URL（`?tab=transport`）→ 可分享，同 layer 三同步一致

⚠️ 呢個係唯一要寫新 code 嘅一項。**做之前先做 A+B+C**（做完即刻靚好多）。

---

## E. 圖例（legend）—— 先查重複

`symbols.ts` L230 已有 bucket table（wind barb），註解提到 *"without a legend lookup"* → 圖例概念已存在。

**世界標準**：地圖底部一排 swatch（World Monitor：Low Risk / High Risk / Critical / Escalating / New / Resolved）。

⚠️ **但 LAYERS 面板每行已經有 ⓘ（來源 + 出處）** → 加圖例之前要確認唔重複。
**建議**：圖例只做**語義**（顏色代表咩風險級別），唔做圖層清單（嗰個 LAYERS 面板做）。

---

## F. 視覺質量（你嘅要求：「最緊要好好睇睇」）

你已經有嘅（**守住，唔好重做**）：
```
glassmorphism   --glass backdrop-filter（panel + palette + focus-hud）
動畫            @keyframes panel-in（.18s）/ panel-flash（1.4s，用於 ⌘K 跳去 panel）
狀態色          .panel.is-stale 琥珀邊 / .is-error 紅邊
字距            .panel-head h2 letter-spacing .2em（儀表銘牌感）
tokens.css      已集中管理顏色/字體/間距
```

**加密度時要守：**
- ❌ 唔加新色系 —— 用 `tokens.css` 現有變數
- ❌ 唔將 panel 塞到冇上下留白（`padding:11px 12px` 係校準過）
- ✅ 列表 3-4 行（World Monitor 標準）
- ✅ `params.max` 控行數，唔好 hardcode
- ✅ 已 `prefers-reduced-motion` 處理 → 保持

---

## 執行次序

```
1. A 直播 2 條              ← 純 config，5 分鐘，即刻有兩條新直播
2. B 兩欄                   ← 3 行 CSS，視覺提升最大
3. C 查 LAYERS 為何唔顯示    ← 查唔係建
4. D tab 分類               ← 唯一要寫新 code
5. E 圖例                   ← 查完 C 之後才決定
```

**每一項做完要證明**：截圖（1440 同 375 兩個闊度）+ DOM audit。唔可以自報。

---

## 紅線

- ❌ 唔加新 npm dependency（`web/package.json` 而家只有 `maplibre-gl`）
- ❌ 唔用 `live_stream?channel=`（已實測失敗）
- ❌ 唔重寫 `layercontrol.ts`（已經做對）
- ❌ 唔發明新 `group` 名（跟 `sources.json` 嘅 12 個）
- ✅ 兩欄之後手機（≤880px）要回落單欄
- ✅ 每個 panel 保留 traceability footer

---

*2026-09-23 · 全部由 VPS 實測你部機嘅 code 寫成*
