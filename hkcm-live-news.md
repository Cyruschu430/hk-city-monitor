# HK City Monitor — Live News TV 頻道清單

**量度日期**：2026-09-27 · **方法**：喺 Cyrus 部 PC（住宅 IP）跑 `web/scripts/resolve-live-news.mjs`，逐個頻道 `youtube.com/@handle/live` 抽 videoId，再用 `i.ytimg.com/vi/<id>/hqdefault_live.jpg` 驗 live 狀態。

---

## 0. 先講最重要嘅發現

**香港廣播機構冇 24/7 YouTube 直播。**

試過嘅 handle：`@tvbnews` `@TVBNews` `@tvbcomhk` `@icable` `@icablehk` `@cabletvnews` `@nowtv` `@nowtvhk` `@nownewshk` `@hoytv` `@HOYTVHK` `@HOYTVofficial` `@HK01` `@hk01news` —— **全部 404 或冇 live**。

原因唔係技術問題：TVB／有線／now／HOY 嘅新聞台**有版權限制同自己嘅 app**，YouTube 只放剪輯，唔放 24/7 台。

**所以「香港 live news」呢條路，免費 embed 係封死嘅。** 出路有三：
1. **向外**——大中華／亞太／世界頻道（下面清單）
2. **RTHK** —— 港台有 YouTube，但**只做活動直播**（例：特首記者會），唔係 24/7
3. **保留現有 17 條香港景色 cam** —— 佢哋雖然唔係 news，但係**一城密度**嘅實時影像，World Monitor 冇

**呢個就係點解原本個清單係 17 條 webcam。**

---

## 1. ✅ 驗證 live（可以直接用）

### 大中華
| handle | videoId | 直播標題 | 穩定？ |
|---|---|---|---|
| `@phoenixtvglobal` | `Ry--eMIjYLQ` | 鳳凰衛視 24小時直播間 | ✅ 24/7 品牌 |
| `@cctvchinese`（Cyrus 提供） | `vNVp6bxkL1c` | CCTV中文国际(亚洲) | ✅ 24/7 |
| `@CGTN` | `0i7n3r01L2U` | 🔴 Watch CGTN LIVE 24/7 | ✅ 24/7 品牌 |
| `@setn` | `w_dqgeGTlpw` | 【台灣地震LIVE】24時間リアルタイム地震速報 | 🟡 常設監看 |

### 亞太
| handle | videoId | 直播標題 | 穩定？ |
|---|---|---|---|
| `@channelnewsasia` | `XWq5kBlakcQ` | [CNA 24/7 LIVE] Breaking news on Asia | ✅ 24/7 品牌 |
| `@NHKWorldJapan` | `IimtbuqYIE8` | LIVE: NHK WORLD-JAPAN News | ✅ 24/7 品牌 |
| `@ytnnews24` | `iH4wyxHWyLU` | YTN 뉴스 (韓國) | ✅ 24/7 頻道 |
| `@CNAInsider` | `fSUMKrxPEd8` | CNA Originals LIVE | 🟡 品牌但內容輪換 |

### 世界財經
| handle | videoId | 直播標題 | 穩定？ |
|---|---|---|---|
| `@business` | `OlUMDZchivQ` | Bloomberg Originals LIVE | ✅ 24/7 |
| `@CNBC` | `9NyxcX3rhQs` | LIVE: CNBC Marathon | ✅ 24/7 |
| `@YahooFinance` | `KQp-e_XQnDE` | Yahoo Finance 24/7 Stream | ✅ 24/7 品牌 |

### 世界新聞
| handle | videoId | 直播標題 | 穩定？ |
|---|---|---|---|
| `@aljazeeraenglish` | `gCNeDWCI0vo` | 🔴 Al Jazeera English \| Live | ✅ 24/7 品牌 |
| `@dwnews` | `LuKwFajn37U` | DW News livestream \| Headline news | ✅ 24/7 品牌 |
| `@euronews` | `pykpO5kQJ98` | Euronews English Live | ✅ 24/7 品牌 |
| `@FRANCE24` | `a47ckXKZjxI` | FRANCE 24 – EN DIRECT | ✅ 24/7 品牌 |
| `@NBCNews` | `wCzFV6XV1yI` | LIVE: NBC News NOW | ✅ 24/7 品牌 |
| `@ABCNews` | `N9mqdbh9s3Y` | LIVE: ABC News Live | ✅ 24/7 品牌 |
| Cyrus 提供 | `iipR5yUp36o` | ABC News Live | ✅ |
| Cyrus 提供 | `GotlA1KKWoo` | CNN Headlines 24/7 | ✅ |
| `@SkyNews` | `YoKj1VIkFXE` | World leaders speak at UN General Assembly | ⚠️ 標題係事件，但 Sky News 台係常設 |

---

## 2. ❌ 唔好加（會重現 `GxMB-EH_lJs` bug）

呢啲解析到 live，但**個 video ID 會死**——標題入面有日期或一次性事件：

| handle | videoId | 標題 | 點解唔要 |
|---|---|---|---|
| `@financialtimes` | `ggsLEEwn4vo` | FT Weekend Festival Live Stream | 一次性活動 |
| `@tbsnewsdig` | `JiQpDkWumOs` | 【ニュースライブ】…（**9月26日**） | **每日換片** |
| `@ANNnewsCH` | `fL6O26oRmzI` | 【ライブ】**9/26** 深夜ニュース | **每日換片** |
| `@ETtoday` | `DSfb-U-gPHs` | 【LIVE】沈伯洋合體何欣純…（20260927） | 事件直播 |
| `@WION` | `3wvWtKR7tsE` | UNGA 2026 LIVE | 事件直播 |

**呢個就係 `live_streams.json` 嘅 `_removed` 註釋講嘅陷阱**——RTHK 係因為咁樣被移走。

---

## 3. 判別規則（可以直接寫入 code）

一個 live id 值唔值得硬編，睇標題：

```
穩定（可以硬編）  標題含 "24/7" / "LIVE: <電視台> News" / "<電視台> Livestream"
唔穩定（唔可以）  標題含日期（9月26日 / 9/26 / Saturday, September 26）或具體事件名
```

**更硬嘅驗證**：隔 24 小時再跑一次 `resolve-live-news.mjs`，同一個 handle 回同一個 id = 穩定。

---

## 4. 兩個腳本（已放喺 `web/scripts/`）

```bash
node scripts/resolve-live-news.mjs                 # 內建候選清單（34 個）
node scripts/resolve-live-news.mjs @CGTN @dwnews   # 或者自己指定
node scripts/probe-livestreams.mjs                 # 審核 live_streams.json 入面每個 id
```

**⚠️ 一定要喺 PC 跑，唔可以喺 VPS 跑。**

VPS 實測：**12 個 handle 全部回 null**（YouTube 對 datacenter range 回一個冇 canonical、冇 og:url、冇 isLiveNow 嘅殼頁）。
PC 實測：第一次跑就有真 id。

**同 adsb.fi 對 Cloudflare egress 回 403 係同一個原因。**

---

## 5. 下一步選項

| 方案 | 工作量 | 效果 |
|---|---|---|
| **A. 加一個「世界新聞台」面板** | 小 | 直上 12+ 條真 news，同現有 17 條 cam 分開 |
| **B. 加 `region` 欄位落 `live_streams.json`** | 更小 | 現有面板自動包括，但 17+15=32 格 |
| **C. 只換走幾條最弱嘅 cam，補入 news** | 最小 | 保持 17 格 |
