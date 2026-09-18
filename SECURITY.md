# SECURITY.md — 公開專案安全規範

> **前提：呢個 repo 係公開嘅，而且會 host 喺 Cloudflare Pages（git push 即出街）。**
> 公開 = 任何人（包括攻擊者）睇得到每一個 commit、每一行、每一段歷史。
> 下面唔係建議，係硬規則。

---

## 0. 最重要嘅一句

**Commit 咗嘅 secret 就係已經洩漏嘅 secret。**

就算你下一個 commit 刪咗佢，佢仍然喺 git 歷史裡面、喺 fork 裡面、喺爬蟲嘅快取裡面。
唯一正確嘅反應係：**即刻去發出嗰個嘅服務 rotate（換新 key）**，唔係刪檔案。

---

## 1. 絕對唔准入 repo 嘅嘢

| 類別 | 例子 | 正確做法 |
|---|---|---|
| API key / token | Google Maps key、Cesium ion token、任何 `sk-` / `gho_` / `AIza…` | Cloudflare Worker env var（`wrangler secret put`） |
| SSH key | `~/.ssh/id_*` | 永遠唔離開本機 |
| `.env` | 任何 `.env` 檔案 | `.gitignore` 已擋，只 commit `.env.example`（**值要係空白或者明顯假**） |
| 密碼 | basic auth、admin PIN | Worker secret |
| 私人資料 (PII) | 姓名、電話、地址、車牌、報料內容 | **完全唔准入公開 repo**。見 §5 |
| 內部文件 | 客戶名、報價、合約 | 唔屬於呢個 repo |
| 真實 IP / hostname | VPS IP、內部 hostname | 見 §4 |

**判斷法**：如果呢行嘢貼上一個公開 gist 你會有少少唔舒服 —— 就唔准入 repo。

---

## 2. 三道防線（全部免費）

1. **`.gitignore`**（已有）—— 擋 `.env` / `*.key` / `secrets*`
2. **Pre-commit hook** —— 每次 commit 前掃描，捉到就唔准入
   ```bash
   # 一次性設定
   pip install detect-secrets   # 或者用 gitleaks
   detect-secrets scan > .secrets.baseline
   ```
3. **GitHub Secret Scanning + Push Protection** —— **公開 repo 免費**，GitHub 會主動阻止推送已知格式嘅 key
   設定：repo → Settings → Code security → 開啟 Secret scanning + Push protection

**第 3 道最重要**，因為佢唔靠你記得。

---

## 3. 前端永遠冇秘密

任何落喺瀏覽器 JS 嘅 key，**用戶按 F12 就睇到**。冇例外。所以只有三條路：

| 情況 | 做法 |
|---|---|
| 真係免 key 嘅源 | ✅ 直接用（我哋 164 個源大部分係） |
| 要 key 但可以限制 | 限制 **HTTP referrer** 到你個 domain（Google Maps 支援） |
| 要 key 又限制唔到 | **經 Worker 代理**，key 只留喺 Worker |

**唔准**將 key 寫入 config、寫入 commit 嘅 JSON、或者「暫住先」放喺前端。

---

## 4. Cloudflare 架構：一個 Worker 解決三個問題（實測驅動）

我實測全部 164 個源嘅 CORS：

```
可以瀏覽器直連（ACAO=*）       62
必須經 proxy（冇 ACAO 或白名單） 99   ← 60%
```

呢個推翻咗早期「純靜態就做得到」嘅講法 —— 嗰個講法對相機牆成立，對全目錄唔成立。

**所以：一個 Cloudflare Worker 同時解決三件事**

1. **解 CORS** —— 前端打自己個 Worker，Worker 去打源
2. **藏 key** —— key 只喺 Worker env
3. **藏源頭 IP** —— 攻擊者只見 Cloudflare，見唔到任何 origin

再加上 Worker cron triggers 做定時收集（唔需要 VPS）。

### 攻擊面規則

| 規則 | 點解 |
|---|---|
| **唔好喺公開專案暴露 VPS IP** | VPS 冇 Cloudflare 擋，一洩漏就係直接攻擊目標 |
| **唔好喺公開專案暴露 duckdns hostname** | 同上 |
| Worker 加 **rate limit** | 免費層有基本保護，但 public endpoint 一定要限速 |
| 任何表單加 **Turnstile** | 免費，擋 bot |
| 只准 **GET**，唔准 POST 通用代理 | 唔好將 Worker 變成開放 proxy（會俾人當跳板） |
| **白名單目標 URL** | Worker 只准打 sources.json 列出嘅 host，唔准任意 URL |

最後一條係關鍵：一個「傳咩 URL 都幫你 fetch」嘅 Worker 會馬上俾人當免費 proxy 用。

---

## 5. PII 規則（你特別提過）

大部分源係公開資料，**所以公開 repo 冇問題**。真正風險喺兩處：

1. **報料 inbox（P3）** —— 呢個係唯一會收到市民私人資料嘅功能。
   **硬規則**：報料流程**完全唔准入呢個公開 repo**。要另開一個 private repo / 或者純 Worker + private storage。
   公開 repo 只可以有「報料入口」嘅 UI，唔可以有儲存邏輯。
2. **爬蟲快取** —— 唔准將含 PII 嘅原始回應 commit 入 `data/`。
   只 commit **已聚合／已去識別化** 嘅輸出。

**去識別化都唔算安全**：如果一區只有一單事件，去咗名都推得到係邊個。呢類要人手過。

---

## 6. 交貨前檢查清單

```bash
# 1. 有冇 secret 混入？（全歷史掃描）
git log -p | grep -iE '(api[_-]?key|secret|token|password)\s*[:=]' | grep -v example

# 2. .gitignore 有冇擋住敏感檔？
git status --porcelain | grep -E '\.env|secret|credential'

# 3. 有冇硬編碼 IP？
grep -rEn '([0-9]{1,3}\.){3}[0-9]{1,3}' --include='*.json' --include='*.md' --include='*.js' . | grep -v '127\.0\.0\.1'

# 4. 確認 Worker 有白名單 + rate limit
```

**發現洩漏嘅處理次序**：
1. **即刻 rotate 嗰個 key**（唔係刪檔）
2. 用 `git filter-repo` 清歷史（但假設已經洩漏咗）
3. 檢查有冇被用過（睇服務嘅 usage log）

---

## 7. 已經確認安全嘅嘢（唔使再擔心）

- ✅ 我哋 164 個源**全部免 key** —— 冇一個需要 secret 先攞到數據
- ✅ 大部分數據係政府公開資料，發佈本身唔涉 PII
- ✅ `.gitignore` 已擋 `.env`
- ✅ 前端只做 GET，冇寫入操作

**即係話：只要唔亂加新源、唔加 key、唔加報料功能，呢個專案本身就係低風險。**
風險係後來加嘅嘢帶入嚟嘅，唔係而家。
