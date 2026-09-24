# KNOWN_ISSUES.md — 已查清但未修嘅問題

> 只記錄**查清楚**嘅事，唔係猜測。每項有：現象、影響、查到幾深、點解未修。

---

## 1. Console 出現一次 `InvalidStateError: The source image could not be decoded.`

**狀態**：查清來源、**零用戶影響**、未修。

### 現象
切換到「颱風模式」時，console 出現一次：
```
InvalidStateError: The source image could not be decoded.
```

### 查到嘅事實（全部實測）
- 拋出位置：`createImageBitmap`，**stack 喺 `maplibre-gl.js` 內部**（唔係我哋嘅 code）。
- 傳入嘅係一個 **Blob**：`type=image/png`、**2521 bytes**、magic bytes `<!doctype html>`。
- Body 內容係**應用自己嘅 root URL**（`http://localhost:5173/`），由一個 **`fetch`** 請求拎返嚟。
- 用 response 攔截掃過**所有** body 以 HTML 開頭嘅回應：**只有一個**，就係 root URL。

### 影響（實測，唔係估）
```
decode errors during this run: 1
total <img>: 2, broken (naturalWidth 0): 0
panels in error state: (none)
```
**0 張圖爛、0 個 panel 出 error。** 純粹係 console 噪音。

### 已經順手修好嘅（同一條線索揾到嘅真 bug）
1. **`hko_tc_track` 冇氣旋時回 `src: ""`** → renderer 照放入 `<img>`，
   `img.src=""` 會解析成**當前頁面 URL**，拎到 HTML 然後解碼失敗。
   呢個係正常狀態（一年大部分時間都冇氣旋），所以每次都會觸發。
   喺 `render.ts` 加咗 guard：空 `src` 直接出 empty state，唔會產生 `<img>`。
   **呢個係真 bug，已修。**
2. **雷達 404 頁當圖片** —— HKO 對過期時間格回 404 + **180KB HTML**，
   而 `<img>` 會再 fetch 一次。改成 adapter **自己 fetch 完轉 data URL**，
   順便用 magic bytes 驗證真係 JPEG/PNG。
   **呢個係真 bug，已修**（race condition 都一併消除）。

### 點解未修埋最後一個
- 剩低嘅係 **MapLibre 內部**對一個 blob 做 `createImageBitmap`，而個 blob 係 root HTML。
- 已經排除：style 冇 sprite、glyphs 指向 demotiles、所有 raster tile 都回真圖、
  越界 tile 正確回 204 No Content、冇任何 `fetch("")` 或 `new Image()` 喺我哋嘅 code。
- 掃過所有 response：**冇任何** image-type 回應含 HTML body。
- 唯一含 HTML body 嘅係 root URL，但佢係 `resourceType=fetch`，唔應該入到 `createImageBitmap`。

**結論**：呢個係 MapLibre 內部探測行為（可能係佢 fallback 去 fetch 一個空 URL），
**唔影響畫面、唔影響資料、唔會令任何 panel 出錯**。
要再追落去需要入 MapLibre 源碼或者開 devtools 逐步斷點，
以「令用戶睇到嘅嘢更好」為目標，投入产出比唔合理。

**如果將來要修**：喺 `createImageBitmap` 外面包一層 catch（已驗證技術上可行，
test script `probe-decode-catch.mjs` 就係咁做），可以令 console 完全乾淨。
但咁樣係**遮住**而唔係**修好**，而且會隱藏將來真正嘅解碼錯誤 —— 所以**唔建議**。

---

## 2. CoinGecko 加密貨幣 429（生產環境）

**狀態**：已知、上游限流、未決定點做。

- Cloudflare 出口 IP 觸發 CoinGecko 免費層限流（實測 429）。
- Panel **誠實顯示**「未能讀取數據（CoinGecko 加密貨幣）：HTTP 429重試」。
- 本地開發正常。
- **要決定**：保留（誠實 error）／換源／移除。

---

## 3. 上游封鎖數據中心 IP（飛機圖層）

**狀態**：已知、已處理（撤回圖層）、有復活路徑。

| 源 | 你部 PC | Cloudflare |
|---|---|---|
| adsb.fi | 10/10 = 200 ✅ | 403 |
| adsb.lol | 3/10 = 200 ❌ | 429 |

復活路徑：PC-side collector + adsb.fi（見 `PRODUCTION_STATUS.md`）。

---

## 4. 已修：app 開機自動跳去停水模式，18 個 panel 變 1 個

**狀態**：**已修（2026-09-24）**，附迴歸測試。呢個係目前為止影響最大嘅 bug。

### 現象
冷啟動（未撳任何嘢）之後約 2 秒，**17 個 panel 被拆走**，畫面只剩下
`water_suspension_list` 一個 panel，而且**永遠唔會復原**。

### 點揾到
`probe-firstpaint.mjs` 量冷啟動曲線（舊嘅 `audit-production.mjs` 睇唔到，
因為佢**先撳勻所有 tab 同模式先至數 panel**，等於量度自己嘅 workaround）：

```
t=0.3s   18 panels   {"loading":11,"live":7}
t=2.0s    1 panel    {"live":1}          <-- 17 個消失
t=45.0s   1 panel                        <-- 唔會返嚟
```

### 根因（兩層，都係真 bug）
`verticals.json` 嘅停水觸發條件係：
```json
{ "source": "wsd_water_suspension", "field": "records_fresh", "op": "exists" }
```
`trigger.ts` 對陣列嘅 `exists` 係 `v.length > 0` —— 即係**只要有停水通告就觸發**，
同「而家真係爆水管」完全無關。當日有 6 張通告，所以**每次開頁都跳模式**。

而嗰 6 張**全部係「鹹水」**（沖廁水），**冇一個係食水**。即係話：
用戶開個 dashboard，app 自動話「你屋企停水」，但實際上只係沖廁水停。
呢個係**最唔誠實嘅一種畫面**。

### 修法
1. `adapters.ts` 新增 `drinking_now`：只計 `status === "現正停水"` 而且
   `water_type` 含「食水」嘅通告數目（另外加 `salt_only_now` 做記錄）。
2. `verticals.json` 改成 `{field:"drinking_now", op:">=", value:1}`，
   並喺原地寫低 `_comment` 解釋舊條件錯在邊。
3. `trigger.test.ts` 加 3 個迴歸個案：**鹹水／未開始／資料過期 → 都唔准搶總覽**。

### 量到嘅差異
| | 修之前 | 修之後 |
|---|---|---|
| 冷啟動 panel 數 | 18 → **1** | **18**（穩定） |
| 幾時全部 settle | 永遠唔會 | 約 2 秒 |
| live panel | 1 | **15** |

---

## 5. 已修：地圖把「已恢復供水」嘅區畫成紅色停水

**狀態**：**已修（2026-09-24）**，附迴歸測試。

### 現象
地圖大範圍紅色 polygon，覆蓋半個九龍新界，喺**總覽**上面睇落似大災難。

### 根因
`main.ts` 用 `records`（**所有** active 通告）去砌 `activeDistricts`。
當日 149 張通告之中：**116 張係「供水已恢復」**、25 張係「停水仍未開始」，
真正「現正停水」只有 6 張。圖層自己個名叫**「停水受影響地區」**，
畫啲水已經返返嚟嘅區，係同名稱直接矛盾。

### 修法
只取 `status === "現正停水"`。Panel 照樣列出所有通告（連時間戳，係有用嘅歷史），
**地圖講嘅係「而家」，兩者可以唔同，亦應該唔同。**

### 量到嘅驗證
```
現正停水區=4 · 錯誤地畫成停水嘅已恢復區=[]
```
（新增嘅 `verify-browser.mjs` check：「P1 停水區語意」）

---

## 6. 已修：新聞 feed 10 分鐘就報「過期」

**狀態**：**已修（2026-09-24）**，新增 `honesty.test.ts`（8 組斷言）。

### 根因
`cadenceSeconds()` 只認得**數字形態**嘅 cadence。`sources.json` 實際有
**53 種唔同嘅 cadence 字串**，其中 `"continuous"`（18 個源）冇數字，
於是跌落 300 秒默認值 → **10 分鐘就報 stale**。

政府新聞網「治安」頻道**隔夜靜係正常**。實測該 feed 嘅
`lastBuildDate` 係 **2 分鐘前**（feed 本身好健康），但最新一篇文章係
**27 小時前** —— 所以 feed 新鮮度**唔帶任何資訊**。

同一條蟲亦影響 `"snapshot"`（10 個源）、`"annual"`、`"decennial"` 等：
一個**十年更新一次**嘅數據集，喺 10 分鐘後被判定為過期。

### 修法
把「**輪詢頻率**」同「**容忍靜默幾久**」分成兩個函數：
- `cadenceSeconds()` —— 幾久問一次（`panels.ts:262` 仍然用呢個）。
- `quietSeconds()` —— 幾久冇變就**誠實地**算過期。推送式 feed（`continuous`／
  `as issued`）= **24 小時**（Cyrus 2026-09-24 定）；參考資料有獨立階梯。

`honesty.test.ts` 會**讀真實 `sources.json`**，確保冇任何 cadence 字串再靜靜哋
跌落默認值，亦確保階梯**嚴格遞增**。

### 結果
`breaking_news_list` 依然顯示 stale —— **呢個係啱嘅**，佢真係靜咗 32 小時，
超過 24 小時界線。分別在於：以前係**10 分鐘就報**（狼來了），
而家係**真係有事才報**。

---

## 7. 探針自身嘅 bug（已修，值得記低）

`probe-staleness.mjs` 以前等固定 16 秒就讀表，慢開機時只印到 **1 行**，
睇落似資料問題，但緊接住跑嘅 `audit-production.mjs` 見到全部 18 個 panel。
**用 timer 做 readiness gate，量度嘅係 timer，唔係 app。**
已改成 `waitForFunction`：等齊 panel 數目**而且**冇一個仲係 `loading`。

`audit-production.mjs` 亦有同類問題：佢**先撳勻所有 tab 同模式**先數 panel，
所以永遠報 18，掩蓋咗上面 §4 嗰個冷啟動 bug。已在 `verify-browser.mjs`
加入**未撳任何嘢之前**嘅冷啟動斷言（「冷啟動」check）。

---

## 8. 已修：⌘K 命令面板完全開唔到（一個 TypeError 靜靜哋殺咗佢）

**狀態**：**已修（2026-09-24）**。呢個係「撤回一個 panel」時我自己整出嚟嘅，
但佢揭示咗一個一直都存在嘅脆弱點。

### 現象
`verify-browser.mjs` 報 `P1 ⌘K：open=false hits=0` —— 㩒 Ctrl+K **完全冇反應**。

### 我第一反應係錯嘅
我以為係測試自己按咗兩次（面板係 toggle 設計：`open ? close() : openIt()`）。
於是寫咗 `probe-palette.mjs` **單獨**測：結果**一樣開唔到**。
假設被推翻 —— 唔係測試 artefact，係真 bug。

### 根因
`probe-palette-why.mjs` 裝咗一個 capture-phase 監聽器去睇事件有冇到：
```
real page.keyboard.press: {"hidden":true,"spySaw":"k","spyCtrl":true}
page errors: TypeError: Cannot read properties of undefined (reading 'tc')
```
**事件有到**（`spySaw="k"`, `ctrlKey=true`），但 listener **拋錯死咗**，所以冇開到面板。

`.tc` 讀 undefined = 有個 language object 唔見咗。原因：我撤回 `crypto_prices`
時，喺 `panels.json` 個 array 入面留咗一個**只有 `_comment` 嘅物件**（冇 `id`、冇 `title`）。
`ui/palette.ts` 嘅 `buildIndex()` 會 iterate `registry.panels` 然後讀 `p.title.tc` →
**拋 TypeError**。

### 點解 validator 捉唔到
因為我**同時改咗 validator** 去跳過冇 `id` 嘅項目（以為 `_comment` 係無害嘅慣例）。
即係我自己拆咗個閘，然後踩落去。**兩個改動一齊做，互相掩蓋。**

### 修法
1. `panels.json`：撤回嘅 panel 放喺**根層** `_withdrawn_panels` key
   （同 `_comment`／`_renders` 並排，唔會入到 runtime array）。
2. `validate_config.py`：**還原**成唔准跳過 —— array 入面任何冇 `id` 嘅項目都係 error，
   並喺原地寫低點解。
3. `verify-browser.mjs`：⌘K check 改成斷言**真正開到**（`open=true` 而且搜到結果），
   唔止係「唔拋錯」。

### 量到嘅驗證（`probe-palette.mjs`，單獨跑）
```
after FIRST Ctrl+K   {"hidden":false,"visible":true,"items":1075,"activeEl":"palette-input"}
after typing 尖沙咀    {"hidden":false,"visible":true,"items":2}
after Escape         {"hidden":true,"visible":false}
after SECOND Ctrl+K  {"hidden":false,"visible":true,"items":1075}
```
**1075 個項目**（模式＋panel＋相機），搜「尖沙咀」中 **2 個**。

### 教訓
> **一個「無害嘅註解」放入 runtime 讀嘅 array，就唔再係註解。**
> 註解要放喺**唔會被 iterate** 嘅地方（文件根層、sibling key），
> 而且**唔准為咗讓一個改動通過而改鬆個 validator** —— 兩者一齊做，就冇任何嘢守得住。

---

*2026-09-24 · 全部實測*
