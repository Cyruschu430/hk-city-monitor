# PRIMITIVES.md — 共用零件 spec（零件 2–7）

> 交俾 coding agent 嘅實作合約。目標：**之後加任何 vertical 都只係填 JSON。**
>
> 呢份 spec 刻意寫得細。要做嘅係 4 個資料檔 ＋ 2 個 function，唔係一個框架。
> 下面有「唔准建」清單 —— 違反就係今次想避免嘅返工。

---

## 0. 一句話設計

```
verticals.json  講「有邊啲場景、每個場景用邊幾個 panel」
panels.json     講「一個 panel 係邊個源、點樣呈現」
layers.json     講「地圖圖層係乜」
render.mjs      一個 renderer，讀上面三份 → 出畫面
trigger.mjs     一個純函數：(狀態) → 應該開邊個 vertical
```

**Registry 係資料，唔係 class。** 唔准寫 `PanelRegistry.register()` 呢類嘢。

---

## 1. `data/panels.json` — panel registry

一個 panel = 一個源 ＋ 一種呈現方式 ＋ 參數。

```json
{
  "id": "rain_nowcast_map",
  "source": "hko_rain_nowcast",
  "render": "raster_map",
  "title": { "tc": "格網降雨臨近預報", "en": "Gridded Rainfall Nowcast" },
  "params": { "bbox": [22.15, 113.83, 22.56, 114.44], "opacity": 0.6 },
  "cadence_note": { "tc": "每 12 分鐘更新", "en": "Updated every 12 minutes" }
}
```

**規則（由 validator 強制）**
- `source` **一定要**存在於 `sources.json`。打錯字 = build 失敗，唔係 runtime 空 panel
- `render` **一定要**係下面封閉清單之一
- `cadence_note` 必填 —— 用戶要知個數字係幾新
- **`tc` 同 `en` 兩個都要有，缺一即失敗。** 香港嘅官方語文係**繁體中文同英文**，
  兩者並列。半翻譯唔係「未做完」，係一個 bug —— 所以 validator 當錯處理，唔當 warning

### `render` 封閉清單（8 種，唔准加）

| render | 用嚟做 | 例子 |
|---|---|---|
| `big_number` | 一個大數字 | 恒指、AQHI |
| `list` | 文字清單 | 天氣警告、停水通知 |
| `table` | 表格 | 航班、渡輪班次 |
| `image_single` | 一張圖 | 雷達圖、衛星圖 |
| `image_wall` | 相機牆（縮圖格） | 1013 台交通相機 |
| `raster_map` | 格網圖層疊地圖 | 降雨臨近預報 |
| `gauge_grid` | 多站數字格 | 18 個 AQHI 監測站 |
| `status_grid` | 狀態格（綠／黃／紅） | 口岸輪候、風球 |

**加第 9 種 render = 要改 spec ＋ 要寫理由。** 呢條規矩就係「vertical 唔准自己寫 code」嘅執行機制。

---

## 2. `data/layers.json` — layer registry

```json
{
  "id": "cameras_all",
  "source": "td_cameras",
  "render": "image_wall",
  "geom": "point",
  "title_zh": "交通快拍",
  "popup": "camera_popup",
  "filters": { "scope": "hk" }
}
```

`geom` 封閉清單：`point` / `polygon` / `line` / `raster` / `none`。

---

## 2.5 語言規則（香港官方語文）

**繁體中文 ＋ 英文，兩者並列，缺一即 build 失敗。**

- `tc` = **繁體**（唔係簡體）。validator 會檢查有冇中文字
- `en` = 英文，唔可以含中文
- **唔准**用 `title_zh` / `_zh` 呢類後綴再配一個英文版 —— 兩個語文係同一個欄位嘅兩個值，
  唔係兩個欄位。分開兩個欄位一定會 drift（改咗中文唔記得改英文）
- 語言由 renderer 按 locale 揀，**唔准喺 vertical 層各自處理**

## 3. `data/verticals.json` — vertical definitions

```json
{
  "id": "typhoon",
  "name_zh": "颱風模式",
  "question": "聽日飛唔飛得成？掛唔掛 8 號？",
  "trigger": { "any": [ { "source": "hko_warnsum", "field": "TC8", "op": "exists" } ] },
  "panels": ["tc_track_image", "rain_nowcast_map", "warnings_list", "flight_table"],
  "layers": ["cameras_all"],
  "window": "now",
  "location_scope": "hk",
  "order": ["warnings_list", "tc_track_image", "rain_nowcast_map", "flight_table"]
}
```

**必填欄位嘅意思**
- `name` 同 `question` 都係 `{ "tc": …, "en": … }`，**兩語齊全**（同上）
- `question` **必填** —— 呢個 vertical 答邊個具體問題。答唔到就唔准做（`VERTICALS.md` 第五部分）
- `trigger` 可以是 `null`（純人手開）。有 trigger 就係 `{"all": [...]}` 或 `{"any": [...]}`
- `panels` / `layers` 只可以引用**已存在**嘅 id
- `window`：`now` / `today` / `7d` / `season` / `year`
- `location_scope`：`hk` / `district` / `route`
- `order` —— 內容同 `panels` 一樣，但決定顯示次序。**一定要有**，唔准靠 array 順序（排序係設計決定，要明寫）

### trigger 條件語法（只用呢幾個 operator，唔准擴充）

| op | 意思 |
|---|---|
| `exists` | 該欄位存在 |
| `>=` / `<=` / `==` | 數值比較 |
| `in` | 值喺一個清單入面 |

`source` 要存在於 `sources.json`；`field` 係該源回傳嘅 JSON 路徑。

---

## 4. `lib/trigger.mjs` — 純函數

```js
/** @returns {string|null} 應該自動開嘅 vertical id，冇就 null */
export function activeVertical(state, verticals) { … }
```

- `state` 係一個普通 object：`{ warnings: {...}, aqhi: 7, notices: [...], context: {...} }`
- **一定係純函數** —— 冇 fetch、冇 LLM、冇副作用。所以寫得到 unit test
- 多過一個符合 → 回 `priority` 最高嗰個；同分 → 按 `verticals.json` 次序
- **唔准喺呢條路徑用 LLM。** 風球同暴雨警告係生死資訊，要可稽核、可測試、可解釋

---

## 5. `lib/context.mjs` — location ＋ time

```js
export function appliesTo(item, context) -> boolean
export function filterByScope(items, context) -> items
```

`context = { scope: "hk"|"district"|"route", district: "深水埗", route: [[lat,lng],…], now: "2026-09-18T20:30+08:00" }`

- `hk` → 全部
- `district` → 只留該區（用一個 `district` 欄位過濾；冇該欄位嘅源當全港共享）
- `route` → 只留路線附近（**buffer 距離要寫成常數，唔准喺 UI 層計**）

`route` 係關鍵一級：佢令「返工模式」同「跑步模式」變同一套引擎兩個 config。

---

## 6. `lib/render.mjs` — 一個 renderer

```js
export function renderPanel(panel, data, honesty) -> HTMLElement
```

`honesty` 一定係 `"loading" | "live" | "stale" | "error"` 四態之一（見 `DESIGN_BRIEF.md`）。

- **一個 renderer 處理全部 8 種 render**，唔准每個 vertical 自己一個
- `stale` 態**一定要顯示來源時間**，唔准靜靜哋出新畫面
- 冇數據 → 出明確嘅「冇數據」格，**唔准空白、唔准估**

---

## 7. Validator（必要，唔係可選）

`scripts/validate_config.py`（已寫好，跑得）檢查：

1. 每個 `panel.source` / `layer.source` / `trigger.source` 都存在於 `sources.json`
2. 每個 `render` 都喺封閉清單
3. 每個 vertical 都有 `question` 同 `order`，而 `order` 同 `panels` 內容一致
4. 冇重複 id
5. 引用嘅 panel／layer id 真係存在
6. 警告：引咗 `todo: true` 或者實測 🔴 嘅源

**呢個 validator 就係驗收閘。** 加 vertical 之後跑一次，綠燈先算做完。
佢同時係「vertical 唔准加 code path」嘅機械執行機制 —— 引用唔存在嘅 render 種類會即刻失敗。

---

## 8. 唔准建（YAGNI，違反 = 返工）

| ❌ 唔准 | 點解 |
|---|---|
| Plugin / registry class | Registry 係 JSON，唔需要註冊機制 |
| Event bus | 冇需要；直接 function call |
| 狀態管理 library | Vite + TS + MapLibre 就夠，唔加依賴 |
| DI container | 冇多個實作 |
| 每個 vertical 一個 renderer | 呢個就係返工嘅定義 |
| LLM 落 trigger 路徑 | 生死資訊要可稽核 |
| 一個 vertical 一個 repo 資料夾 | Vertical 係 config entry，唔係 module |
| 為「將來」預留抽象層 | 將來自己會搭 |

---

## 9. 驗收（交貨前要跑）

```bash
python3 scripts/validate_config.py     # 綠燈
```

再加兩個 test（assert 式，唔用框架）：

- `lib/trigger.test.mjs` —— T8 觸發颱風模式；冇警告回 `null`；同一輸入兩次結果一樣（純度）
- `lib/context.test.mjs` —— `district` 過濾正確；冇 `district` 欄位嘅源唔會被濾走

**唔准講「應該 work」** —— 跑完貼返真實輸出。
