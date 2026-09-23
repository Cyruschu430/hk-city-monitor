# PRODUCTION_STATUS.md — Worker 部署後實測

> 2026-09-23。Worker 已部署：`https://hk-city-monitor.cyrus738.workers.dev`
> 全部數字係**喺 production 實測**，唔係估算。

---

## 部署結果

```
Upload   : 8.31 KiB / gzip 3.07 KiB
URL      : https://hk-city-monitor.cyrus738.workers.dev
Version  : 61276d1d-3c0a-4158-a393-eaea9d1bf12f

/health      → {"ok":true,"version":"0.2.0","whitelistHosts":67}   ✅
/config/3d   → 3 條 WGS84 tileset URL                               ✅
```

### 代理源實測（103 個全部掃過）

| 結果 | 數量 | 意思 |
|---|---|---|
| **200 OK** | **89** | 生產環境正常工作 |
| 403 | 2 | 上游拒絕數據中心 IP |
| 429 | 2 | 邊緣限流 |
| 其他（404/400/422/500/504） | 10 | 逐個有原因，見下 |

**89/103（86%）喺生產環境正常。** 部署前係 0，因為瀏覽器完全掂唔到 CORS 封閉源。

### 安全實測（production）

| 測試 | 結果 |
|---|---|
| 非註冊 host | 403 ✅ |
| 邪惡 TLD 假冒 (`data.weather.gov.hk.evil.com`) | 403 ✅ |
| cloud metadata (`169.254.169.254`) | 403 ✅ |
| localhost | 403 ✅ |
| 純 http | 400 ✅ |
| 邊緣快取 | HIT ✅（call 1 已經 HIT，證明會 cache）|

---

## 10 個非 200 源嘅分類（**冇一個係新壞嘅**）

### A. 上游封鎖數據中心 IP（4 個）—— 部署**之後**才出現

```
adsb_fi_hk     403   上游擋 Cloudflare 出口 IP
adsb_lol_hk    429   Cloudflare 共享 IP 被限流
airplanes_live 403   本來就 403（sources.json 已註明）
opensky_hk     504   匿名限流
```

**⚠️ 呢個係真嘅新問題，要處理：**

- 飛機圖層喺**本地**（`wrangler dev`，你屋企 IP）完全正常，59 架。
- 喺**生產**（Cloudflare 出口）兩個 ADS-B 源都俾人擋。

**逐個實測（2026-09-23）：**

| 源 | 你部 PC | Cloudflare Worker |
|---|---|---|
| **adsb.fi** | **10/10 = 200** ✅ | **403**（所有請求） |
| **adsb.lol** | **3/10 = 200，7/10 = 429** ❌ | **429**（所有 endpoint） |

adsb.lol 補測過 3 個 endpoint（`/v2/point`、`/v2/hex`、`/v2/closest`），
**全部都係 429**，就算冷卻 60 秒之後**單一個**請求都係 429 —— 即係佢限流嘅係
**共享數據中心 IP**，唔係我哋嘅突發量。返嘅 header 係 `X-HKCM-Upstream-Status: 429`，
證明係上游俾嘅，唔係 Worker 自己。

**結論**：
- **adsb.lol 唔可以當後備** —— 生產唔得，本地連續請求都唔穩定。
- **adsb.fi 喺本地 10/10 成功**，係唯一可行嘅 collector 來源。

**影響**：部署之後，`aircraft_status` panel 同航機圖層**已經撤回**（唔會出 error 態）。
**唔係我哋嘅 bug** —— Worker 正確咁 pass through 上游狀態碼，而且**冇 cache 錯誤**。

**可行方案（推薦）**：用 **PC-side collector**（同 `build_water_suspension.py` 同一個模式）：
你部機定時抓 adsb.fi（10/10 實測成功）→ 寫 static JSON → 前端讀。
零成本、零 key，而且係實測過得嘅路。

### B. 已知嘅源頭問題（6 個）—— 部署前已經係咁

| 源 | 狀態 | 原因（sources.json 已記錄） |
|---|---|---|
| `hko_radar` | 404 | **用 template URL，唔可以直接 fetch** —— app 用 `radarCandidates()` 砌時間戳，係 expected |
| `hko_satellite` | 404 | 同上，時間戳路徑 |
| `tdas_traffic` | 500 | 已記錄：403／封鎖，唔係 dead source |
| `lcsd_leisure_prog` | 400 | 已記錄：`http` scheme 問題 |
| `sunferry_eta` | 422 | 已記錄：`route` 參數要落 query string |
| `ck_hk_dpo_..._pressrelease_search` | 400 | CKAN 全掃自動匯入，未 review |

**呢 6 個全部 `todo` 或者已知參數問題，唔係部署造成。**

### C. 限流（1 個）

```
coingecko  429   免費層限流，keyless。app 有 fallback。
```

---

## 要跟進

1. **🟢 飛機圖層**：已撤回（唔會出 error 態）。要復活就用 **PC-side collector + adsb.fi**
   （本地 10/10 實測成功）。詳見上面同 `sources.json` 兩條 ADS-B 條目嘅註解。
2. **`hko_radar` / `hko_satellite`**：app 應該用 template 路徑（`radarCandidates()` 已經係咁做），
   但 `sources.json` 嗰條 URL 仲係 template，sweep 會 404 —— **expected，唔使修**。
3. **8 個 400/422 源**：值得逐個查係唔係 URL 寫法問題（`lcsd_leisure_prog` 嘅 http→https、
   `sunferry_eta` 嘅 route 參數）。
4. **CoinGecko 429**：共享免費層被 Cloudflare 出口 IP 觸發限流。Panel 誠實報錯。
   要決定係保留（誠實 error）定換源。
5. 本地 `.env` 已指向 production Worker；要返本地開發就改成 `http://localhost:8787`。

---

## 本地 build 指令（實測）

```powershell
cd C:\hk-city-monitor\web
# 生產（用已部署 Worker）
Set-Content .env -Value "VITE_WORKER_BASE=https://hk-city-monitor.cyrus738.workers.dev" -NoNewline -Encoding ascii
npm run build

# 本地開發（要先 cd worker; npx wrangler dev）
Set-Content .env -Value "VITE_WORKER_BASE=http://localhost:8787" -NoNewline -Encoding ascii
npm run build
```

⚠️ `VITE_WORKER_BASE` 係 **build-time**（AGENTS.md Pitfall 17）。
冇咗呢個值，7 個 panel 會由真數據變成「需要 Worker 代理」。

---

*2026-09-23 · 全部實測，唔係估算*
