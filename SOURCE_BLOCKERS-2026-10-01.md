# 收唔到嘅源 —— 實測報告 2026-10-01

**方法**:由 `sources.json` 讀齊 **180 個源**,同時用兩個視角測:
- **edge** = 經 live Worker proxy(`/proxy?url=…`)→ 證明 Cloudflare 攞唔攞得到
- **origin** = 由 VPS 直連 → 證明上游本身生唔生

**結果**:`edge-ok 89` · `origin-ok 64` · `5 個冇 HTTP URL`(內部/FED/collector 檔)
→ **153/180 正常**。以下係**真正**卡住嘅(已排除我自己探測方法問題:URL 係 template、或本身要 POST/參數)。

## 真正卡住(7 個)

**1. `wsd_water_suspension` —— 只有 Cyrus 部 PC 收得到** ✗✗
`https://www.esd.wsd.gov.hk/wsms_open_data/WSMS_OPEN_DATA(all).csv`
- origin(VPS/Python):**URLError**(static-RSA TLS 交握失敗)
- edge(Worker):**BoringSSL 直接拒收**(code 註解已記載)
- **兩邊都收唔到**;只有 Windows TLS stack 收得 ✓
- 影響:**「臨時停水通知」面板 + 停水模式(Run 4 嘅 gate vertical)**
- data.gov.hk **冇**替代(CKAN 查 `water supply`/`water suspension`/`WSD` = 0 命中)

**2. `adsb_fi_hk` —— 只有 Cloudflare 邊緣收唔到** ✗
`https://opendata.adsb.fi/api/v2/lat/22.32/lon/114.17/dist/100`
- origin:**200 JSON** ✓ · edge:**403**(adsb.fi 封 CF 邊緣)✗
- 影響:航班面板嘅**其中一個**上游(另一個 `adsb_lol_hk` 由 edge 攞得到 ✓)

**3. `airplanes_live` —— 兩邊都 403** ✗
`https://api.airplanes.live/v2/point/22.32/114.17/100` → 403(VPS 都唔通)
影響:航班面板嘅備用源(非必要)

**4. `coingecko` —— 只係邊緣被 rate-limit** ✗
- origin:**200** ✓ · edge:**429**(CF 共用出口 IP 被限流)✗
- 影響:加密貨幣價格面板 → **加 edge cache TTL 可修**(Worker 每 N 分鐘只打一次,唔理幾多人睇)

**5. `opensky_hk` —— 邊緣 timeout** ✗
- origin:**200** ✓ · edge:**504**(Worker subrequest 超時)
- 影響:航班面板備用源

**6. `tdas_traffic` —— 兩邊都唔通** ✗
`https://tdas-api.hkemobility.gov.hk/tdas/api/route` → edge 500 / origin **403**
即係**要 key 或 session** → 違反「唔准 metered key」硬規則 → **應該剔除**

**7. `hko_satellite` / 其他 template 類** —— **唔算卡住** ✓
404 係因為我用固定日期(`2026091819`),app 自己會砌當前時間戳 ✓

## 我探測方法出錯嘅(源其實正常,唔可以屈佢)✓

`hko_radar`(URL 係 template `_{YYYYMMDD…}`) · `open_meteo_wind_grid`(template `{LATS}`) ·
`bus_eta_citybus_nlb` / `lwb_eta` / `sunferry_eta`(**422 = 要參數/POST**,API 係生嘅) ·
`ck_hk_dpo_…pressrelease_search`(400 = 要 POST) · `rvd_property_market`(200 CSV ✓) ·
`adsb_lol_hk`(URL 係 `data/aircraft.json` = **讀 collector 檔**,唔係上游)

## 對架構決定嘅意思(重要)

**唔係「好多源壞」,而係一個模式**:
> **Cloudflare 嘅共用出口 IP 被部分上游嫌棄**(429 / 403 / 超時)✗

- 純 CF(Workers + Pages Functions)方案 → **只會失去 2–3 個可選面板**(crypto 可 cache 修好、opensky 可丟)
- **唯一真正的硬阻塞 = 停水(PC-only)** ✗ → 即係你嗰個「唔想用 PC」嘅目標,**只有停水一個源頂住**
- 所以:**停水面板留唔留,就係「可唔可以完全唔要 PC」嘅唯一開關** ✓

## 可做嘅修法(如要留停水)

1. **接 GitHub Actions 每日一次**收水檔(Windows runner 有正常 TLS ✓)→ UI 老實寫「每日更新」
2. 或者**維持 PC 每 10 分鐘**收(現狀,但要 PC 開機)
3. 或者**public demo 唔要停水面板**(你嘅原則:顯示唔到就唔好留)✓ 最懶


---

## 🔴 追加更正(同日稍後):4 個源壞,根因只係 `http://`

我第一版報告把 `rvd_property_market` 同兩個 EPD 源歸類為「我探測方法問題 = 正常」**係錯嘅** ✗
原因:我當時係**直連 origin**(會跟 301 去 https ✓ 所以見 200),但 **app 走嘅路係 Worker proxy**,
而 proxy **只代理 `https://` 目標**(守衛:`{"code":"https_only"}`)✗ → 即係 app 裏面真係壞。

**registry 共 4 個 `http://` 源(全部壞)**:
1. `rvd_property_market`(proxy)→ 400 https_only ✗ = **物業市場面板壞**
2. `ck_hk_epd_airteam_past_record_of_air_pollution` ×2(proxy)→ 400 https_only ✗
3. **`ck_hk_td_tis_1_special_traffic_news`(`fetch: browser`)** → 由 https 頁面 fetch http
   = **mixed content 被瀏覽器封** ✗ = **「特別交通消息」面板卡 `loading`**
   ✓ 同我早前用真瀏覽器探測見到嘅症狀完全對上(`STILL_LOADING: ["特別交通消息", "港鐵 下一班列車"]`)

**已驗證嘅修法(4 個字 × 4 個源)**:`http://` → `https://` ✓
```
https://www.rvd.gov.hk/datagovhk/1.1A(86-98).csv          → proxy HTTP 200  2,886 B
https://www.aqhi.gov.hk/api_history/download/hourly/eng/hr071999.csv → proxy HTTP 200 33,655 B
https://resource.data.one.gov.hk/td/en/specialtrafficnews.xml       → HTTP 200(https 正常)
```

**教訓**:驗證源唔可以只測 origin —— **app 嘅路(browser / proxy)才係真相**,
而 proxy 有 `https_only` / registry allow-list 兩道守衛,會令「origin 200」嘅源照樣壞。
