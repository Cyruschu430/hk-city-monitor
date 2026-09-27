# HK City Monitor — 驗證方法論

> 一份關於「點樣證明一個前端改動真係做到嘢」嘅記錄。
> 全部數字都係實測，冇一個係估。日期：2026-09-27。

---

## 一句話

**一個前端改動未算完成，直到你量度咗你想改嘅嗰個屬性，而個數字同你預測嘅一樣。**

Build 綠燈只證明啲 code parse 得到。Typecheck 綠燈只證明啲 type 夾。兩樣都同「畫面出唔出到」冇關係。

---

## 一、證據階梯

由弱到強。**停喺最強嘅一級，唔好停喺「過咗」嗰級。**

| 級別 | 證明咗咩 | 唔證明咩 |
|---|---|---|
| 1. Build 成功 | 代碼 parse 得到 | 任何嘢 |
| 2. Typecheck 過 | 型別夾 | 任何嘢 |
| 3. 單元測試過 | 純函數正確 | 畫面 |
| 4. 截圖睇落 OK | 有嘢喺度 | 係咩、幾多、啱唔啱 |
| 5. **DOM 量度** | **真實渲染出嚟嘅結構同數字** | 個 check 本身會唔會失敗 |
| 6. **負面測試**（故意整壞 → 應該 FAIL） | **個 check 真係 load-bearing** | — |

**第 5 級係最低要求。第 6 級係唯一能證明個 check 有用嘅方法。**

> **一個你只見過佢 pass 嘅 guard，唔算 guard。**

---

## 二、三個量度工具

### 1. DOM 量度（唔係截圖）
```js
page.evaluate(() => ({
  groups: p.querySelectorAll(".tl-g").length,
  rows:   p.querySelectorAll(".tl-ev").length,
  span:   p.querySelector(".tl-span")?.textContent,
}))
```
問「有幾多個」，唔問「睇落點」。數量、文字、計算後嘅樣式 (font-size / border-color) 全部拎得到。

### 2. 網絡量度
`page.on("request")` + `page.on("response")`，量真實傳輸同狀態碼。
例：**首屏總量 2,383,316 → 1,658,877 bytes**；`hasBasicInfoRequest: false` 證明上游呼叫真係冇咗。

### 3. 變異測試（mutant）
將修復還原，跑同一個 check，**確認佢 FAIL**。
例：將 `stamp()` 改返「永遠只出時刻」→
```
FAIL  a group that crosses midnight — the span must carry the date
the span reads BACKWARDS — exactly the defect this checks for: "23:50–00:30"
exit=1
```
**呢一步係紀律，唔係可選。**

---

## 三、Vision 嘅正確用途

**Vision 係提示，唔係判決。**

| 可靠 | 唔可靠 |
|---|---|
| 版面結構、分區 | 具體文字內容 |
| 元素存在與否 | 數量 |
| 大致視覺風格 | 顏色數值 |

**實測案例**：Vision 讀一張時間線截圖，正確指出「兩個區塊、三條領域配對」，但**報咗兩個唔存在嘅新聞台名**（CNN、VTV24 —— 數據入面完全冇）。

**做法**：Vision 嘅結論必須同 DOM 量度對上。兩邊對上 = 可信；對唔上 = 以 DOM 為準。

---

## 四、五個案例研究

### 案例 1 — 554KB，為咗三個欄位

**問題**：`basic_info_all.json` 每次冷載入下載 **554,726 bytes**，佔首屏 30%。
**真相**：parser 由 554 筆記錄入面**只讀 3 個欄位**（`park_id`、`name_tc`、`name_en`）。
**點解過得咗 review**：`parsers.ts` 有一段**準確**列出成個 key 清單嘅註釋 —— 然後用咗三個。註釋岩，所以令人信個 payload 係必需。

```
內容分佈：remark_* 52%（大部分係空字串）· 簡體重複副本 21% · website_* 10% · 相片 8%
```
**修法**：collector 寫精簡版 → **554,726 → 53,001 bytes（−90%）**，面板一模一樣。
**規矩**：比對 `Object.keys(payload)` vs parser 實際 destructure 嘅欄位 —— **唔係**比對文件話有咩。

---

### 案例 2 — 一個冇 retry 嘅致命 guard，將 flake 報成 defect

**問題**：加咗「app 冇 boot 就 exit 1」嘅致命 guard（正確，防假過關）→ `check:all` 喺一個健康 build 上 **exit=1**。
**真相**：冷啟動嘅 browser backend **一定會輸咗第一次 navigation**。第二次一定成功。
**修法**：retry 一次，之後仍然致命。**兩次失敗就係結果。**
**關鍵**：要**一次過套用落所有 browser check**。只修中招嗰個，其他兄弟照樣報假缺陷。

---

### 案例 3 — 一個由源清單計出嚟嘅數字，唔係量度

**問題**：安全文件寫「冷載入 ≈ 49 個 request → 每日約 2,000 次冷載入」，並**用嚟支持一個架構提案**（將 104 個源搬去 static JSON）。
**真相**：49 係**由 registry 嘅源數量估出嚟**。實測 **26 → 每日 3,846 次**，估高咗接近一倍。
**結論**：**提案唔做。** 用一個 collector pipeline 去消除一個有 3,846 倍餘裕、而且失敗模式零成本（唔收錢、冇資料損失、午夜自動回復）嘅風險，係過度工程。
**交付**：記錄真實數字同「唔做」嘅理由。**呢個就係交付。**

---

### 案例 4 — 兩個「空頁面照過關」嘅 check

**問題**：兩個 layout/contrast check 都寫住
```js
await page.waitForFunction(ready, null, {timeout:45000}).catch(() => {});   // 吞咗
```
**而兩者嘅 assertion 全部係「關係式」**（overlap、row track vs scrollHeight、低於 4.5:1）。
**空頁面 = 冇元素 = 冇關係被違反 = 全過。** 實測報 `panels 0/0 ... LAYOUT OK`。

**修法**：readiness 改為致命 + 加最少元素數斷言。
**證明**：故意打錯 port → `exit=1`。**假過關堵死。**

---

### 案例 5 — 一個 check 靜咗六個 commit

**問題**：`app.css` 第一行變咗 `/* HK City Monitor v0.2 â€” hand-written CSS`（UTF-8 被當 cp1252 讀再存）。**藏咗六個 commit。**
**真相**：`check:encoding` 每次都跑，**但佢寫去 stderr**，而所有驗證都用 `2>&1 | Select-Object -Last N` —— 崩潰嘅命令會印**乜都冇**，而「乜都冇」被當成乾淨。

**呢個陷阱喺「命令本身就係 check」嘅時候最毒**：build 冇輸出可疑；**verifier 冇輸出望落好似乾淨跑完。**

**修法**：
- 用**一個聚合命令**（`npm run check:all`）＋**睇 exit code** 決定，**永不用 grep transcript 決定**。
- 靜默係設計嘅 check，都要印一行正面輸出。
- **負面測試唔准經 shell 還原佢改過嘅檔案**（`Set-Content -Encoding UTF8` on `Get-Content -Raw` 會毀掉所有非 ASCII）。改副本，或者事後由 source of truth 重上。

---

## 五、可搬走嘅清單

做完任何前端改動，問：

- [ ] 我量度咗**我想改嘅嗰個屬性**，而數字同預測一樣？
- [ ] 個數字係**DOM／網絡**量出嚟，唔係截圖睇返嚟？
- [ ] 我有冇**故意整壞佢，確認個 check FAIL**？
- [ ] 我個 check 會唔會**喺空白頁面上過關**？
- [ ] 個 check 嘅判定，我係睇 **exit code** 定係 grep 文字？
- [ ] 靜默係設計嘅話，我**印咗一行正面輸出**未？
- [ ] 我加嘅新欄位／新檔案，**四個 registry 都點名**未？
- [ ] Vision 嘅結論同 DOM 量度**對得上**？（對唔上以 DOM 為準）
- [ ] 我報嘅數字，**有嘢 OBSERVE 過**，定係由清單計出嚟？

---

## 六、貫穿全部嘅一句

**量度，唔好睇。**
**整壞佢，證明你捉得到。**
**冇咗嘅數字，唔好當佢係 0。**
