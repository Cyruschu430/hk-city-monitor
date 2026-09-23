# DO_THESE.md — 只有你可以做嘅四件事

> 2026-09-23。每一項都有**實測狀態**、**逐步指令**、**點知成功**。
> 唔需要理解成個 codebase，照住做就係。

---

## ✅ 1. 基線收集排程 —— **我已經幫你做咗**

唔使做。已經註冊咗 Windows 工作排程，每小時跑一次，而且**實測跑過成功**：

```
TaskName    : HKCM baseline collector (hourly)
State       : Ready
LastResult  : 0        (0 = 成功)
```

**驗證方法**（想自己確認就跑呢句）：
```powershell
Get-ScheduledTaskInfo -TaskName "HKCM baseline collector (hourly)" | Select LastRunTime, LastTaskResult
```

**你要做嘅只有一件事**：幾日之後，把累積到嘅數據推上 GitHub，Pages 先會見到：
```powershell
cd C:\hk-city-monitor
git add data/baselines.json
git commit -m "chore(data): baseline collection"
git push
```
⚠️ **只 add `data/baselines.json`**，唔好 `git add -A`，會夾埋其他未 ready 嘅嘢。

**點知成功**：開 http://localhost:4173/ 睇「異常與匯聚」panel 最底，
應該見到 `1/14 日`（今日）→ 幾日後變 `3/14 日` → 14 日後基線規則先開始有可能觸發。
**呢個要等 14 日，冇得快**——gate 數嘅係日數，唔係樣本數。

---

## 🔑 2. Cloudflare 登入 + 部署 Worker —— **最高回報**

### 為咩咁重要
```
sources.json fetch 分佈：proxy 103 / browser 67 / n/a 5   （共 175）
```
**103 個源（59%）要經 Worker 代理**。Worker 未部署 = 呢 103 個源**全部用唔到**。
呢個係單一最大嘅槓桿。

### 實測現況
```
wrangler 版本：4.135.0  ✅ 已裝
登入狀態：You are not authenticated.   ❌ 未登入
```

### 步驟
**① 喺你自己嘅終端機**開一個 window（唔係 agent session），跑：
```powershell
cd C:\hk-city-monitor\worker
npx wrangler login
```
會自動開瀏覽器 → 揀你嘅 Cloudflare 帳號 → 撳 **Allow**。
（免費計劃就夠，唔使加卡。呢個就係揀 Cloudflare 嘅原因：超額會**停**，唔會**收錢**。）

**② 登入完，返嚟同我講**，或者自己跑：
```powershell
cd C:\hk-city-monitor\worker
npx wrangler deploy
```
跑完會印一條 URL，好似 `https://hkcm-proxy.<你嘅名>.workers.dev`。

**③ 把條 URL 話我知**，我會：
- 更新 `web/.env.example`
- 重新 build（`VITE_WORKER_BASE` 係 **build-time**，見 AGENTS.md Pitfall 17）
- 跑 harness 確認代理源真係通

### 點知成功
```powershell
curl "https://<你條 worker url>/health"
# 應該見到 {"ok":true,"version":"0.2.0","whitelistHosts":67}
```

### ⚠️ 注意
- Worker **必須有白名單**（已經有，67 個 host）—— 唔准做開放 proxy，會俾人當跳板
- **唔好加信用卡**
- 如果你已經有其他 Worker 用咗同一個名，`wrangler deploy` 會問你改唔改名

---

## 🚢 3. AISStream 免費 key —— 解鎖船舶圖層

### 實測現況
```
C:\Users\cyrus\.aisstream_key  →  MISSING
```

### 步驟
1. 去 **https://aisstream.io** → 撳 **Sign in with GitHub**（免費）
2. 撳 **Create API Key** → 複製條 key
3. 開 PowerShell，跑（**把 `PASTE_KEY_HERE` 換成你條 key**）：
```powershell
Set-Content -Path "$env:USERPROFILE\.aisstream_key" -Value "PASTE_KEY_HERE" -NoNewline -Encoding ascii
```

### 點知成功
```powershell
Test-Path "$env:USERPROFILE\.aisstream_key"     # 應該 True
(Get-Item "$env:USERPROFILE\.aisstream_key").Length   # 應該 > 20
```

### ⚠️ 注意
- **條 key 唔可以入 repo、唔可以貼公開頻道**。`.aisstream_key` 喺你 user home，
  唔喺 repo 入面，所以唔會 commit 到。
- 官方條款明寫：*"The API key belongs in a server-side environment variable"*
  → 所以條 key **只會喺 VPS collector 用**，前端永遠冇 key。
- **誠實提醒**：香港係 AIS 弱覆蓋區（陸基接收站為主），遠洋船可能收唔到。
  圖層出街前要先量度覆蓋率，唔可以畫到好似全部船都見到。

### 做完之後
話我知，我會將 collector 出嘅 JSON 接去前端圖層。

---

## 🧭 4. 新聞政治內容 —— **只有你可以決定**

### 現況（實測）
- Ticker 同「突發新聞」panel 用 `gov_news_law_order`
  （政府新聞網**治安（法治）**分類）
- 呢個 feed 係官方原文轉載
- **公開之後收唔返**：一旦出街，就係你嘅編輯立場

### 三個選項，揀一個

**A. 保留現狀**
官方治安消息，對「城市態勢」主題係切題嘅。風險：會被視為有政治立場。

**B. 換做純交通／天氣**
最中性。但會少咗一個真實資訊來源。
（`td_specialtrafficnews` + `hko_warnsum` 已經有，直接改 ticker 嘅 source 就得。）

**C. 保留 + 加明確聲明**
例如喺 panel footer 加一行：
> 只轉載政府新聞網原文，不代表本項目立場。本項目與政府無關。

呢個係**最誠實**嘅做法，而且同你 AGENTS.md 開頭寫嘅
「Not affiliated with the HKSAR Government」一致。

### 你要做嘅
**話我知揀 A / B / C。** 兩個鐘內改好（改 config + 跑 gate）。

---

## 做完之後

| 你做完 | 我會做 |
|---|---|
| `wrangler login` + deploy | 改 `.env.example`、rebuild、驗證 103 個代理源 |
| 條 Worker URL | 更新 build、跑 harness 確認 |
| AIS key 放好 | 接船舶圖層 |
| 揀 A/B/C | 改 ticker／panel 措辭 |
| 等 14 日 | 基線規則開始觸發，`異常與匯聚` panel 出真事件 |

**唔使等我**：你做完任何一項，隨時同我講，我即刻接落去做。

---

## 我啱啱順手修好嘅嘢（你唔使做）

1. **「累積中 X/14 日」之前永遠顯示唔到** —— 因為 `evaluate()` 喺檢查 maturity 之前
   就已經 skip 咗冇值嘅規則。但「仲喺累積」嘅訊號**通常就係**冇值嘅嗰啲，
   所以要資料先顯示 = 喺最需要顯示嘅時候收埋。已修好，實測 4 個訊號全部顯示 `1/14 日`。

2. **4 個收集嘅訊號之中只有 1 個有規則用** —— 即係 3/4 嘅收集工作白做。
   已補 3 條 baseline 規則（口岸／空氣／風），而家每個收集到嘅訊號都有規則消費。

---

*2026-09-23 · 狀態全部實測，唔係估*
