# UI / UX Review & Refinement Plan — HK City Monitor v0.2.1

> 用途：畀下一次 coding session（deepseek flash v4）照單執嘅實作計劃。
> 睇圖材料：
> - 本 app 現況：`web/test/artifacts/review/r1-overview.png`、`r2-panels.png`、`r3-map.png`、`r4-typhoon.png`、`r5-border.png`、`r6-mobile.png`
> - World Monitor 參考：`web/test/artifacts/review/wm1-home.png`、`wm2-settled.png`（Screenshot 已 cap，但如 coding model 冇 vision，以本文文字為準）
> - 對照來源：World Monitor（worldmonitor.app 官網 copy，2026-09-21 fetch）+ DESIGN_BRIEF §0.5（WM + God's Eye View 語法實測紀錄）+ 今次六張 screenshot 嘅逐格分析

---

## 0. 現況強項（唔好拆）

- **LIVE ticker**（status bar 下面，特別交通＋突發合流、紅 tag、reduce-motion 安全）——World Monitor 式 breaking ticker 做咗出嚟，keep。
- **香港直播（第三方）牆**——2×4 縮圖 + 紅色「LIVE 直播」badge、off-air 出「現時無直播」，視覺上係全屏最靚嘅區，keep。
- **四態誠實**（loading/live/stale/error）＋ 每 panel footer 有來源名＋連結＋更新時間——呢個係同 WM 睇齊嘅「every figure sourced」賣點，keep。
- **地圖 base**：LandsD 官方地形圖（加暗 0.52/1.12）＋繁中標籤＋地政署標註——識別度最高嘅位，keep。
- **Autoload 即出數據**（停水自動切換、全部 fetch 就緒）——WM「the map is already moving, nothing to configure first」已經做到，keep。
- **颱風 mode 個降雨 panel**嘅「現時無降雨（~0 mm）+ mm 圖例」誠實空態做得啱。

---

## 1. P0 — 真 bug，必修（今次 screenshot 親眼實測）

### 1.1 地圖 layer 同 mode 切換嘅 race（最嚴重）
**現象**：r1/r4/r5 三個 mode 嘅地圖都仲見到停水分區嘅紫色網格（`vl-water_suspension_districts-*`），連總覽、颱風、口岸都應有而唔應有。r4（颱風）映到紫色網格＋紅色停水區喺度。
**原因**：`applyModeLayers` 係 async——water mode 嘅 CSDI fetch 未返之前，用戶（或 script）撳咗下一個 mode → `clearVerticalLayers(map, drawnLayers)` 嗰陣 `drawnLayers` 仲係 `[]` → 之後個 in-flight polygonLayer 照落咗 layers，變成 orphan，冇人再清。
**做法**：`main.ts applyModeLayers` 加 generation counter（`layerGen++`），`applyVerticalLayers` / `polygonLayer` / `rasterLayer` 每次 `addSource` 前檢查 `如果 gen !== currentGen 就 throw abort`；或簡單啲——切 mode 時 await 完上一次 applyModeLayers 先開始下一次（排隊）。
**驗收**：verification 加一步——撳停水→立即撳總覽→等 3s→`window.__map.getStyle().layers` 唔可以有 `vl-*`；切過三個 mode 都係咁。

### 1.2 「自動切換」banner 唔會因人手切 mode 而消失
**現象**：r1（人手撳咗總覽之後）仍然見到「自動切換：停水模式 [轉返總覽]」。
**做法**：`activateMode(id, manual=true)` 時如果 banner 係 trigger banner → 清走；只有 trigger 自己觸發嘅自動切換先顯示。
**驗收**：撳 總覽 → #mapHud .panel 消失。

### 1.3 口岸輪候：99 分鐘 sentinel 誤讀
**現象**：r5 顯示 香園圍／落馬洲支線／文錦渡 ＝ 紅色「99 分鐘↔99 分鐘」。實情：23:00 呢啲管制站已關閉，99 係 ImmD「closed / no data」sentinel（實測之前 payload `HYW arrQueue 99`）。
**做法**：`parseImmdQueue`：`min(arr, dep) >= 98` → 唔係 queue 數字，出灰色「已關閉」狀態（新 status 值，如 `-1` → 顯示「已關閉」灰 dot，唔入紅/黃/綠）；`0` 維持「少於 15 分鐘」。
**驗收**：fixture 加 `{arrQueue:99, depQueue:99}` 站 → 顯示「已關閉」＋灰色，唔係「99 分鐘」紅。

### 1.4 跨境渡輪：upstream 舊數據當 live
**現象**：r5 渡輪 table 啲行係 `05-13 09:05`（5 月）但 panel chip 顯示「啱啱」。唔係碼頭啱啱到船——係上游 CSV 嘅內容日期遠古。
**做法**：`parseFerry` 將第一欄（`YYYY-MM-DD HH:mm`）parse 出嚟；adapter 用「最新行日期」做 `observedAt`（唔係 fetch time）→ 過 cadence 即誠實轉 stale；同時加一句 note 顯示「來源班次截至 05-13」，或者只顯示今日行，冇就用「今日暫無班次」。
**驗收**：parsers.test 加 case——全部行係舊日期 → observedAt 係嗰個日期；browser 驗證渡輪 panel 唔會喺日期長期舊嗰陣顯示 live。

### 1.5 手機 status bar 爆格（390px）
**現象**：r6 status bar 一團糟──brand 同 mode 字重叠、時間同「繁中/EN」疊住（「HK CITY MONITOR**式 相機 23:03:2** HKT」）。
**做法**：`@media (max-width:880px)`：status bar 隱藏 video-sub、「相機 N」、tiles via 字樣（已有 hide-s class，但唔夠）；brand 縮細至 11px；clock 用「HH:MM」唔出秒；**驗證 tap target 同唔重叠**。
**驗收**：390px viewport 下 `#statusbar` 內所有項目 `scrollWidth（原 sum）<= 390` 且無字重叠（screenshot + 檢查）。

### 1.6 熱帶氣旋 panel 名重複
**現象**：r4 tc_track_image note 顯示「DUJUAN DUJUAN · 62 個定位點」——因為該 XML 冇 `TropicalCycloneChineseName`，fallback 攞咗英文名做兩個名。
**做法**：`parseTcTrack` 或 adapter：`tcName` 同 `enName` 相同時只顯示一個；有中文出「杜鵑 DUJUAN」，冇就出「DUJUAN」。

---

## 2. P1 — UI/UX refine（對照 World Monitor / God's Eye View）

### 2.1 ⌘K Command Palette（WM「Hit ⌘K / Ctrl-K. Commands. Jump to any layer, panel or country without learning the UI first」）
- 全模式/全 panel/全部 13 個 overview panel 可搜尋跳轉；鍵盤 `Ctrl/Cmd+K`、Esc 閂；dark 背景、mono 結果行、上下鍵選。
- 加 `Focus`（搜 camera id 或街名→flyTo＋開 drawer）——用 `cameras_td.json` 嘅 name 做搜尋源。
- 唔加新 runtime dependency（自己寫，vite 底下一個 module）。
- 驗收：`Ctrl+K` 開、打「尖沙咀」出機場/相機、Enter flyTo＋drawer 開。

### 2.2 Layers 視覺噪音壓低＋重點區有 label（對照 GEV「boxed HUD labels tethered by leader lines」）
- 停水分區層：非活躍區 `fill-opacity 0.07→0.03`、`line 0.8→0.5`；**活躍區**（有停水）加：`fill 0.22→0.30`、line 2px alert 色、同埋 **district 名 label**（symbol layer，`get DISTRICT_CHINESE`，`text-field`，Noto Sans TC 12px，白/紅）。
- 驗收：活躍區一望就知係邊區（r3 而家要靠 popup 先知）。

### 2.3 Map chrome（WM 有 scale／GEV 有 constant readout）
- `ScaleControl({maxWidth:140, unit:'metric'})` bottom-left。
- Nav control 換 dark 樣（`.maplibregl-ctrl-group` background `--panel-solid`、border hairline；而家默認白底好亮）。
- bottom-left 加 **coordinate readout**（mouse move 顯示 `22.xxxx, 114.xxxx`，mono 10px dim，GEV「constant readouts」語法）。
- 驗收：地圖四角有 zoom/scale/座標，視覺同 dark theme 一致（screenshot 檢查）。

### 2.4 左 rail 可讀性
- Mode 圖標太多相似（typhoon/border/water/leave 四個細 icon 唔太分到）。改用 **簡化幾何＋顏色**：颱風=紅、邊境=青、水=藍、離開=綠（只喺 icon stroke 加 accent 色，唔大改）。
- Rail 寬度由 56px 保持；hover tooltip 已有。Wide screen（≥1400px）時 mode 按鈕底下加 9px 迷你 label。
- 驗收：唔 hover 都估到邊個掣係邊個 mode。

### 2.5 直播牆細節
- 縮圖 `object-fit: cover` 統一 16:9 crop（YouTube hqdefault 係 4:3，兩個 4:3 並排時 panel 好高）；tile `aspect-ratio: 16/9`。
- label 溢出 ellipsis 已做，但 channel 名縮短（`title` attr 完整顯示；視覺上用一行）。
- 直播牆一個 panel 8 格 4 行嫌高：overview 用 6 格 2 行（max:6）或 4 格 1 行。
- 驗收：screenshot 睇直播牆 tile 變 16:9、panel 高度合理。

### 2.6 Panel 內容格式（跟 WM watchlist grammar）
- **港股 panel** 改用 WM 式 `名稱 + tag + 價格 + 變幅`：而家 table 第一格淨係名，加細 tag（指數／股份／加密），`變幅` 紅/綠已做；header 唔要。
- **突發新聞 item 時間**：絕對日期 → 相對（「2 日前」）＋ title attr 放絕對。
- **口岸 status grid**：`少於 15 分鐘↔少於 15 分鐘` 個 ↔ 太嗦——改「到 X · 離 Y」，0 直接「暢順」；station 名 mobile 唔好截斷（minmax(140px,1fr)）。
- 驗收：每個 panel 一望明。

### 2.7 天氣警告空態更似 WM「live right now」
- `warnings_list` 空態而家係大字「現時無生效天氣警告」——太好。
- 加 **「最近 24 小時天氣提示」入 rhrread**？唔好——唔加 scope。保留。

### 2.8 Footer 一致性
- `panel-foot` 而家 `來源名 · cadence @ 時間` 字太多太細；改兩行：第一行來源名＋cadence（現有），第二行 `更新時間 HH:MM:SS HKT` mono。已 done 大半，確認不重叠。

---

## 3. P2 — 想做但可之後（記錄，唔入今次 scope）

- **GEV tethered HUD 焦點框**：相機 click 唔用 MapLibre popup，改 leader-line 繫住一個 compact box（名字＋live 縮圖＋座標），200ms 動畫。取代現有 popup 或加喺 popup 之上。
- **Ticker channel tabs**（WM「Live News per-channel tabs」）：政府新聞／交通／RTHK 三個 tab 換 ticker 內容源。要加 RTHK RSS parser（源已有 `rthk_*`）。
- **Aerial basemap 微調**：night 太暗已處理，日間 imagery 對比再試 0.55/1.15。
- **Land 航拍 fallback 次序**：Esri 第三後備。

---

## 4. 明確唔做（constraints，唔好越）

- 唔加 AI brief / AI insights（LLM 唔入 runtime path，AGENTS.md 死規）。
- 動畫預算照 DESIGN_BRIEF §5：冇 >240ms，冇 particle/starfield/bloom；`prefers-reduced-motion` 全停。
- 唔加新 runtime dependency（除非寫明原因）。
- 唔拆 config-driven 架構：新 panel = panels.json + adapters；新 render type 要先改 spec。
- 所有 UI 文案繁體中文（Cantonese 語感），英文 parallel；唔好半譯（validator 會 check）。

---

## 5. 驗收（coding session 完要行晒）

```
cd web
npm run typecheck        # 0 錯
npm test                 # 4 套全 PASS（parsers 會加 1.3/1.4 啲 case）
python ../scripts/validate_config.py   # exit 0
npm run build            # OK
# 起 wrangler dev + vite preview，行：
node scripts/verify-browser.mjs http://localhost:4173/   # 目標 36/36+
```

新增 verify 項目必須覆蓋：1.1 layer race、1.2 banner 清除、1.3 99→已關閉、1.4 渡輪 stale、1.5 手機 status bar、2.1 ⌘K、2.2 活躍區 label、2.3 scale/座標、2.4 rail 色彩、2.5 直播牆 16:9。

---

## 7. v0.2.2 視覺複查（原生 vision 睇真 screenshot，2026-09-22）

改用有 image input 嘅 model 直接睇圖（唔再靠 modlens）之後，捉到 4 個**程式化 check 完全捉唔到**嘅問題，全部已修：

| 睇到嘅問題 | 根因 | 修法 |
|---|---|---|
| Ticker 跑馬燈文字壓過 LIVE tag 同 tab pills | `translateX(-50%)` 嘅超寬 track 屬 flex item，動畫令文字滑過整個 row | track 包入獨立 `.ticker-viewport`（`flex:1 1 auto;min-width:0;overflow:hidden`），動畫永遠困喺自己個 box |
| Trigger banner 塞成句問題入 title | `偵測到：停水模式（我嗰區有冇停水？幾時回復？）` | banner 分兩層：粗體標題＋暗色細字 detail |
| 停水圖層變紫色線網（冇 active 區都畫） | 18 區輪廓以 0.03/0.5 畫出，睇落係網 | **冇 active 區就唔畫個層**（`activeList.length === 0 → return`） |
| 有 9 宗停水但地圖零紅區、零區名 | `records` 被 30 分鐘 freshness 閘清空——但個閘係為咗「自動開 mode」呢個生死決定，唔應該連地圖顯示都禁 | state 分兩個 field：`records`（永遠，俾 panel＋地圖）／`records_fresh`（30 分鐘內，只俾 trigger）；`verticals.json` trigger 改讀 `records_fresh` |
| 相機 HUD 同區 popup 重疊彈出 | MapLibre 會 fire cursor 下**每一層**嘅 click handler | district fill 嘅 click 先 `queryRenderedFeatures` 相機層，有中就 return |

複查同時確認咗：ticker tabs、5 km 比例尺、dark zoom 掣、6 格直播牆、新聞相對時間、CJK 區名 label（`localIdeographFontFamily`）、HUD leader line＋drawer 並存、drawer 死機態＋重試——**全部真係畫咗出嚟**。

> 教訓：46 項 DOM/行為 check 全綠，同「睇落啱」係兩件事。以後每次 UI 改動都應該跑 `capture-v3.mjs` 再親眼睇一次。

---

## 8. 呢份 Plan 點嚟（證據）

- `read_image` 逐張睇 `r1–r6`（1600×1000 桌面六視角 + 390px 手機）
- worldmonitor.app 官網（2026-09-21 fetch）：「⌘K」「first 5 min」「lens 一鍵切」「live right now 底欄＋每項附來源」「markets watchlist 格式」
- DESIGN_BRIEF §0.5 已錄嘅 WM/GEV 語法（hero map + rail + dense sub-panels + ticker；GEV：tethered HUD labels + bottom mode bar + teal identity）
- 冇用 vision model 做判斷（modlens 喺本區 400）——以上全部係 Ctrl 實測 DOM/screenshot 或官方文字

---

## 9. v0.4 — 對照 World Monitor **真圖** 嘅 UI/UX pass（2026-09-23）

之前所有 WM 判斷都係靠官網文字同記憶。今次用 headless Chromium **真係 cap 咗 dashboard**：

```
node scripts/capture-worldmonitor.mjs
→ web/test/artifacts/reference/wm-dashboard.png
→ web/test/artifacts/reference/wm-dashboard-finance.png
```

睇完真圖，差距唔喺「靚唔靚」，喺**資訊架構**。四點係之前完全冇做對嘅：

### 9.1 LAYERS 面板（WM 左下）— 我哋完全冇
WM 左下有個真 control：每行 = ☑ checkbox ＋ 該層自己嘅小 icon ＋ 大寫層名（`INTEL HOTSPOTS`、`CONFLICT ZONES`、`UNDERSEA CABLES`…），右邊一個 `ⓘ`（來源／attribution）＋一個 `⤢`（展開）。tick 就出圖，untick 就收。
我哋而家只有一條**被動**嘅 `.map-legend` 文字——睇得，但撳唔到。
**做法**：`paintLegend` 由「列出已畫 layers」升級成 **layer control**：每行有 checkbox、glyph、雙語層名、`ⓘ` 開該層來源／更新時間。tick/untick → `setLayoutProperty(visibility)`（唔重新 fetch）。底部保留一條真 legend（色標 + 符號）。
**驗收**：`#layers` 內 checkbox 可 toggle，`visibility` 真變，`window.__hkcm.drawnLayers` 反映狀態。

### 9.2 底圖要暗到訊號色係「唯一飽和嘅嘢」
WM 地圖近乎黑，所以橙色／紅色訊號一彈出就搶眼。我哋 LandsD topo 加暗 0.52/1.12 仍然偏暖灰、飽和度唔低，overlay 要「爭」先睇得到。
**做法**：topo 層加 `raster-saturation: -0.55` ＋ `raster-contrast: 0.12` ＋ 再壓 `raster-brightness-max`；保留繁中 label 層唔郁（辨識度來源）。訊號色（`#ff5d6c` 停水、`#f59e0b` 警告、`#22d3ee` 相機）加一層暗底之後會自己彈出。
**驗收**：screenshot 目測 overlay 對比提升；`__hkcm` 提供 `basemapTint()` 俾 verify 讀實際 paint 值。

### 9.3 Panel 密度：數字優先，唔係 iframe 優先
WM 每個 market row ≈ 76px：細 label ＋ ticker ＋ **大數字** ＋ inline sparkline。我哋 overview 右欄 ~40% 高度係一個 YouTube 卡牆，panel 又高又鬆，一屏睇到 3–4 個。
**做法**：
- `image_wall` 嘅直播卡由「大卡」改**縮圖列**（16:9，一行兩張，72px 高），LIVE badge 縮細。
- panel 內 gap／padding 收窄，`.panel-body` 由鬆散行距改密行。
- overview 右欄容許 2 欄 grid（`grid-template-columns: repeat(auto-fill, minmax(240px,1fr))`），`big_number`／`table` 撐滿。
**驗收**：overview 一屏見到 panel 數由 ~4 升到 ≥6（verify 數 `#panels .panel` 嘅 `getBoundingClientRect` 可見數）。

### 9.4 標題列係「儀器抬頭」，唔係標題
WM：`GLOBAL SITUATION`（左）＋ `TUE, 22 SEP 2026 16:47:45 UTC`（右），大寫 letter-spaced，似面板銘牌。
**做法**：地圖頂加一條 `.map-head`：左「香港即時態勢 / HONG KONG SITUATION」，右 `HKT + 日期`（live clock）。同 status bar 分工——status bar 講系統狀態，map-head 講「你而家睇緊乜、幾點」。
**驗收**：`#mapHead` 存在、時間每秒跳、手機縮成一行。

### 9.5 底部誠實覆蓋率句（WM 最值得抄嘅一點）
WM 底欄寫：`Digest coverage: complete — 116 publishers, 295 items, feeds 234/245, categories 17/17`。
呢句正是我哋嘅誠實原則，但做咗喺 **chrome** 度而唔係 panel 角。我哋而家有 176 個源但只有 ~21 個 panel 出到街——**唔講出嚟就係誤導**。
**做法**：status bar 底加一行 `.coverage`：`覆蓋：21/176 源上線 · 12 個源今輪錯誤 · 更新 00:42:10 HKT`，並提供展開列出錯誤源。數字由 runtime 真實統計（成功／失敗／過期），唔可以硬編。
**驗收**：verify 檢查 coverage 文字含「源上線」且數字 ＝ `__hkcm.sourceStats()` 回報值；斷網後錯誤數上升。

---

## 10. v0.4 執行次序

1. 9.4 map-head（細、獨立）
2. 9.2 底圖色調（細、影響之後所有目測）
3. 9.1 LAYERS control（中，要改 `main.ts` legend 路徑）
4. 9.5 coverage 句（中，要加 runtime 統計）
5. 9.3 panel 密度（最大，最後做，因為前面幾樣會改變版面比例）

每步後：`npm run typecheck` → `npm test` → `validate_config.py` → `build` → `verify-browser.mjs`（50 項，唔可以跌）→ `capture-v3.mjs` → **親眼睇**。

---

## 11. v0.4 完成紀錄（2026-09-23）

五項全部做完，`verify-browser.mjs` 由 50 → **54 項全綠**。逐項實測數字：

| 項 | 做咗乜 | 實測 |
|---|---|---|
| 9.2 底圖 | topo `opacity .3 / brightness-max .35 / contrast .3 / saturation -.6` | luma 113 → **34**，spread 8（近中性） |
| 9.4 map-head | `#mapHead` 左「香港即時態勢」右 `WED, 23 SEP 2026 01:35:27 HKT` | 每秒跳；跟 mode 改名；切語言即時 relabel |
| 9.1 LAYERS | checkbox + glyph + 雙語名 + `ⓘ`（來源／連結） | tick 真係改 `visibility`（新 check 前後都 assert MapLibre property） |
| 9.5 coverage | `覆蓋：7/13 個面板來源正常 · 3 個過期 · 目錄共 175 個源` | 離線時轉紅＋報錯誤數（新 check） |
| 9.3 密度 | 清單上限＋兩行夾＋gauge 收窄＋wall 3-up | 總捲動 **6316 → 4323px（−32%）** |

### 兩個「量度推翻直覺」嘅記錄（值得留低）

**1. `raster-brightness-max` 冇 `raster-contrast` 就完全冇效。**
試咗三次先搵到：單獨 `brightness-max .45` → luma 110（幾乎冇郁）；單獨 `.22` → luma 112。
用 live paint matrix（`probe-basemap-matrix.mjs`）一行一行量，先發現同一個 clamp **加埋 contrast** 就變 luma 34。
呢個係 MapLibre raster 模型嘅實際行為，唔係文件寫得清楚嘅嘢——所以 probe script 留低咗，下次直接量。

**2. 密度問題唔係「行太多」，係「行太高」。**
`special_traffic_list` 只得 10 行但 1304px 高（每行 ~130px，因為每行係一整句新聞）。
`breaking_news_list` 有 20 行但每行 38px。
同一個「太長」症狀，兩個相反嘅成因：前者要夾行高（1304 → 537），後者要截行數（962 → 455）。
**先量再改**，唔係就up啱一半。

### 未做（留返下一輪）

- 9.1 嘅「展開」`⤢`（WM 有，我哋只做咗 `ⓘ`）——需要一個 panel-level 展開 concept，同 drawer 有重疊，要先諗清楚。
- 9.3 嘅 overview 2 欄 grid：而家仲係單欄。單欄已經夠密（每 panel ≤ 欄高），再分欄要先問「邊個 panel 值得闊」。
- ROADMAP_v0.4 嘅 ANALYTICS / 新資料源（另一條線，未開工）。