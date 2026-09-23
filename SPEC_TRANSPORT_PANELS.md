# SPEC — 加 MTR／九巴 交通面板

> 目標：`mtr_next_train` 同 `kmb_eta` **已經喺 `sources.json` 宣告、已經驗證通**，但冇 adapter → 冇 panel。
> 呢份只加 **2 個 panel**，唔加新 render type、唔加新 dependency、唔加 metered host。
>
> 執行：DSH。驗證：VPS 側截圖 + `hasAdapter()` 檢查。

---

## 0. 實測 payload（2026-09-23 live call，唔係文件推測）

### MTR
`GET https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=ISL&sta=ADM`
```json
{
  "sys_time": "2026-09-23 14:09:20",
  "curr_time": "2026-09-23 14:08:59",
  "data": {
    "ISL-ADM": {
      "UP":   [{ "seq":"1","dest":"CHW","plat":"3","time":"2026-09-23 14:09:59","ttnt":"1","valid":"Y","source":"-" }],
      "DOWN": [{ "seq":"1","dest":"KET","plat":"2","time":"2026-09-23 14:08:59","ttnt":"0","valid":"Y","source":"-" }]
    }
  },
  "isdelay": "N", "status": 1, "message": "successful"
}
```
- key 係 `` `${line}-${sta}` ``
- 每個方向 **最多 4 班**
- **`ttnt` = 幾多分鐘到（字串）** · `plat` = 月台 · `dest` = 3 字母目的地碼 · `valid` = Y/N
- ⏱ 時間格式係 `"YYYY-MM-DD HH:mm:ss"`（**唔係 ISO，冇 `T`、冇時區**）→ parser 要自己處理

### KMB
`GET https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/{stop_id}`
```json
{
  "type": "StopETA", "version": "1.0",
  "generated_timestamp": "2026-09-23T14:09:17+08:00",
  "data": [{
    "co":"KMB","route":"1","dir":"O","service_type":1,"seq":1,
    "dest_tc":"尖沙咀碼頭","dest_en":"STAR FERRY",
    "eta_seq":1,"eta":"2026-09-23T14:13:00+08:00",
    "rmk_tc":"原定班次","rmk_en":"Scheduled Bus",
    "data_timestamp":"2026-09-23T14:08:47+08:00"
  }]
}
```
- **`/stop-eta/{stop_id}` 一次過返晒該站所有路線** ← 用呢個，唔用 `/eta/{stop}/{route}/{svc}`
- `eta_seq` 1..3 = 未來 3 班
- `generated_timestamp` → `observedAt`
- 🔴 **`rmk_tc` = 備註**。實測見到 `"原定班次"` = **按時間表推算，唔係 GPS 追蹤車**。
  **必須顯示** —— 唔顯示就等於將推算當實時，違反 honesty 原則。

---

## 1. 改三個檔案

### (a) `web/src/lib/parsers.ts` — 加 2 個 parser

跟現有風格：pure function、return `{ items/rows, observedAt }`、唔 fetch。

```ts
export interface MtrTrain { ttnt: number; dest: string; plat: string; valid: boolean }
/** 實測 payload：data["ISL-ADM"].UP[] 。time 係 "YYYY-MM-DD HH:mm:ss"（無 T） */
export function parseMtrSchedule(j: {
  sys_time?: string; curr_time?: string; status?: number; data?: Record<string, { UP?: unknown[]; DOWN?: unknown[] }>;
}): { items: ListItem[]; observedAt: Date | null }
// items：每班一個，最多 4×2。title = `往${dest} · ${plat}號月台`，time = `${ttnt} 分鐘`
// valid === "N" 嘅班次：唔好當實班（可以 skip 或者標明）

export function parseKmbStopEta(j: {
  generated_timestamp?: string;
  data?: { route: string; dir: string; dest_tc: string; dest_en: string; eta_seq: number; eta: string; rmk_tc?: string; rmk_en?: string }[];
}): { columns: string[]; rows: TableCell[][]; observedAt: Date | null }
// columns = ["路線", "目的地", "到站", "備註"]
// 「到站」由 eta 減 generated_timestamp 算分鐘；冇 eta 就寫 "—"
// 「備註」照抄 rmk（tc/en 跟 lang()）—— 唔可以省略
```

⚠️ `dest` 係 3 字母碼（CHW/KET）→ 需要一個細 lookup 表（同 `CP_STATIONS` 同款做法）。
由 `line` 加 `sta` 揀表；唔在表就照顯示代碼（**唔好發明中文名**）。

### (b) `web/src/lib/adapters.ts` — 加 2 個 ADAPTERS 條目

跟 `hko_warnsum` / `immd_cp_queue` 嘅形狀：

```ts
async mtr_next_train(src, panel) {
  const line = (panel.params?.["line"] as string) ?? "ISL";
  const sta  = (panel.params?.["sta"]  as string) ?? "ADM";
  const url  = `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=${line}&sta=${sta}`;
  const j = await json(await fetchUrl(url));          // 用現有 fetchUrl，唔用 get(src)（URL 要動態）
  const { items, observedAt } = P.parseMtrSchedule(j);
  return { data: { kind: "list", items }, observedAt, state: j };
},

async kmb_eta(src, panel) {
  const stopId = (panel.params?.["stop_id"] as string);
  if (!stopId) throw new Error("kmb_eta panel 要有 params.stop_id");   // ← 大聲失敗，唔好靜靜哋空
  const url = `https://data.etabus.gov.hk/v1/transport/kmb/stop-eta/${stopId}`;
  const j = await json(await fetchUrl(url));
  const { columns, rows, observedAt } = P.parseKmbStopEta(j);
  return { data: { kind: "table", columns, rows }, observedAt, state: j };
},
```

🔴 **`adapters.ts` 檔頭明文**：「Every adapter either returns data or **throws** — throwing is what puts a panel into its honest error state. It never returns a zero, an empty box, or a cached guess.」
→ 冇 `stop_id` 就 throw，**唔好** 回空表。

### (c) `data/panels.json` — 加 2 個 panel 條目

形狀照 `aircraft_status`。**順手填 `group`**（而家 23 個 panel 全部空 —— 呢個就係 tab 分類嘅來源）：

```json
{
  "id": "mtr_next_train_list",
  "source": "mtr_next_train",
  "render": "list",
  "group": "transport",
  "title": { "tc": "港鐵 下一班列車", "en": "MTR Next Train" },
  "params": { "line": "ISL", "sta": "ADM", "max": 8 },
  "cadence_note": { "tc": "實時", "en": "Real-time" }
},
{
  "id": "kmb_eta_table",
  "source": "kmb_eta",
  "render": "table",
  "group": "transport",
  "title": { "tc": "九巴 到站時間", "en": "KMB Arrivals" },
  "params": { "stop_id": "18492910339410B1", "max": 10 },
  "cadence_note": { "tc": "1 分鐘", "en": "1 minute" }
}
```
- `render` **只可以用 render.ts 嘅 8 個 kind**（第 9 個係 spec 變更，唔係實作決定）
- `params.max` = 行數上限（config，唔係 hardcode；現有機制）
- `stop_id` 先用 sources.json 已驗證嘅 `18492910339410B1`；之後換邊個站由你決定

---

## 2. Worker whitelist

`worker/src/whitelist.generated.js` 係 **generated**：
```
// GENERATED by scripts/build_worker_whitelist.py from sources.json — do not edit.
// Regenerate: py -3 scripts/build_worker_whitelist.py
```
兩個 host（`rt.data.gov.hk`、`data.etabus.gov.hk`）**應該已經在內**（`bus_eta_citybus_nlb` 同 `kmb_eta` 已宣告）。
→ **唔使手改**。跑一次 generator 確認冇 diff 就夠。

---

## 3. 驗證（做完要證明，唔可以自報）

```
1. cd web && npm test          ← parsers.test.ts 應該加 4 個 assertion group：
   · MTR：UP/DOWN 各 4 班 → 8 items；valid="N" 唔當實班
   · MTR：時間字串無 T 都 parse 到
   · KMB：eta 減 generated_timestamp = 正確分鐘
   · KMB：rmk 有顯示（唔可以 drop）
2. hasAdapter("mtr_next_train") === true
   hasAdapter("kmb_eta") === true
3. render：跑 dev server，兩個 panel 出到資料（唔係 error 態）
4. 誠實檢查：故意用一個冇 ETA 嘅 stop_id → panel 要出 error 態（唔可以空表）
```

---

## 4. 紅線（唔可以違反）

- ❌ 唔加新 render kind（render.ts 明文：第 9 個係 spec 變更）
- ❌ 唔加新 npm dependency
- ❌ 唔引入任何收費／要 key 嘅 host（兩個源 `cost: "free"`, `auth: "none"`）
- ❌ 唔做「巴士位置推算視覺化」當實時 —— 官方開放數據**冇車輛座標**。要做就要明標「推算」
- ✅ 必須顯示 KMB `rmk`（原定班次 vs 實時）
- ✅ 必須保留 traceability footer（`sourceName` / `sourceUrl`）
- ✅ 出處：`HKSAR Government 開放數據（data.gov.hk 條款）— 需標明出處`

---

## 5. 之後（唔喺呢個 spec 範圍）

- 加更多站／線（純 config：多幾個 panel 條目）
- `group` 填晒 23 個 panel → 就係 tab 分類（12 個 group 跟 `sources.json`）
- 城巴／小巴／渡輪（`bus_eta_citybus_nlb` 要 POST，`todo: true`）
- **唔好做**：車輛位置推算當實時

---

*2026-09-23 · payload 由 VPS 實測 · 讀你部機嘅架構後寫*
