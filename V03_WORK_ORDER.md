# V03_WORK_ORDER.md — HK City Monitor v0.3

> 2026-09-30。Cyrus 口述需求 → 整理成可執行工作單。
> 執行者:**DSH(PC 側)**。驗證者:**VPS 側(真 DOM audit + network log,唔信自報)**。
> 每項:現況(實測)／要改／檔案／驗收。
>
> **本單三條紅線**(違反即拒收):① 瀏覽器內**冇 LLM、冇 AI 生成文字**,分析一律規則式 ② 每條源必須有
> licence + 更新頻率 + attribution,由 `validate_config.py` 把關 ③ **唔准用 modal/popup 蓋住 map 或 panel**。

---

## P0-0 先驗 live bundle(做任何嘢之前)

**為咩**:`AGENTS.md` 記錄過一次嚴重事故 —— **`git push` 唔會部署**,live 一直食舊
bundle(`assets/index-DmsgbxpK.js`),少咗 Tier 2 timeline、co-domain view、**merged live wall**、
carpark collector。你見到嘅「啲片縮埋一舊、撳落去開 popup 遮晒」**同「舊 bundle 冇 merged
live wall」嘅症狀一致** → 可能唔需要重新設計,只需要部署。

**要改(依序)**:
1. 喺 PC build 最新版 → 記錄新 bundle hash
2. `npx wrangler pages deploy dist --project-name=hk-city-monitor --branch=main --commit-dirty=true`
3. **驗證係睇 artifact 唔係睇 push**:fetch live `index.html` → 讀 `assets/index-*.js` hash →
   喺該 bundle grep 一個新功能獨有嘅字串(例如 `check:livewall` 對應嘅 class)

**驗收**:live hash == PC build hash;而且 live bundle 內搵到你想要嘅功能字串。
**如果 hash 對得上但症狀仍在** → 先做 P0-C;唔係就唔好亂改 UI(避免同已有功能重複實作)。

## P0-A 來源覆蓋:唔夠「有嘢睇」

**現況(實測)**:registry 有源,但用戶一路拉落去睇唔到幾多唔同嘅嘢;Cyrus 原話:
「最主要係啲 data source 唔全面……最起碼個 panel 一路拉落去都有好多唔同嘅嘢睇」。

**要改**:源數量唔係目標,**「可讀內容密度」**才是。每個 vertical 最少要有:
- 1 個實時狀態源(帶時間戳)
- 1 個圖表源(可畫線/柱)
- 1 個清單源(可列 N 行)
- 1 個地圖源(有幾何)

**驗收**:每個 vertical 打開後,panel 內**至少有 12 個可讀項**(行/圖/點)而**唔需要 scroll 超過 2 屏**;
`validate_config.py` 新增檢查:每 vertical 四類齊全,唔齊就 fail。

## P0-B Lazy load:唔好一次過撈晒

**現況**:面板/圖層開機即載。

**要改**:
1. 每個 panel 有 `loader()`;**panel 未展開就唔 fetch**(IntersectionObserver + 展開事件)
2. 首次載入後入 cache(TTL 由源嘅 `refresh` 決定),第二次開即時顯示
3. 切換 tab 唔重載已 cache 嘅 panel
4. 取消:用戶閂 panel → `AbortController.abort()`
5. Worker 白名單要同步加新 path(冇白名單 = 400)

**驗收(必須有證據)**:network log 證明「開機只 fetch 首屏 panel 嘅源」;unopened panel 嘅 source
**零 request**。⚠️ 但 **`npm run check:quota` 唔可以頂爆**(現時上限 34 個 Worker request /
cold load)→ lazy load 要同時減少 cold-load 數,唔可以係「同一批 request 遲啲打」。呢個係本次最重要嘅性能指標,Cyrus 原話:
「你唔使一次過撈晒所有嘢,個 user request 要呢啲嘢嘅時候先俾佢」。

## P0-C Stream dock:直播唔可以搶畫面 ✗ → ✓

**現況(實測,用戶投訴)**:「啲片全部縮埋一舊,你撳落去就開晒成個 panel(popup),
成個右邊變咗一舊嘢遮住晒」。

**要改**(照 World Monitor 模式:webcam panel 支援 **2×2 grid 預設** + **single-feed expanded view**):
1. 做一個 **stream dock**:預設 **2×2 tile grid**,固定在版面一角(唔遮 map)
2. 撳一個 tile = **就地放大該 tile**(dock 內),**唔開 modal、唔遮 panel**
3. tile 可獨立關閉(N 個 tile 隨時開幾個同時睇)
4. **唔自動播**:用戶撳先播(Cyrus 原話:「啲直播都係啦,你撳落去先播咋嘛,你唔係一來就係咁」)
5. 可以拖出成獨立小窗(dockable / PiP),但**永遠保留 map 同 panel 可見**

**HK 現實**:「直播」= **TD 交通快照圖片**(CCTV snapshot,JPG),唔係視訊流 → tile 用
`<img>` + 每 N 秒 refresh 即可,**唔好 embed 第三方 YouTube/串流**(licence + 你控制唔到內容)。

⚠️ **先讀 `AGENTS.md`**:app 已經有 **live wall** ——「a confirmed-live stream plays INSIDE its
live-wall tile, **several at once**, with the tile badge as the stop control(`check:livewall`)」。
如果 P0-0 顯示 live bundle 係舊嘅,咁 P0-C 唔係「重新設計」而係「部署返已存在嘅 live wall」。

**驗收**:DOM audit — 同時存在 ≥4 個 tile 而 `<map 容器>` 同 ≥3 個 panel 仍然可見(未被覆蓋);
`document.querySelectorAll('.modal,[role=dialog]').length === 0`。

## P0-D 財經:得幾隻股票 ✗ → 主要指數 + HK 定位

**現況**:財經只有幾隻股票。

**要改**:加**主要指數**(配置驅動,唔改 code):恒生指數、恒生中國企業指數、上證、日經、
S&P 500、納斯達克、道瓊斯、富時、DAX、VIX、美元兌離岸人民幣、黃金、BTC。
HK 係金融中心 → 恒指/國企指數要**排第一**,並顯示收市/延遲狀態。

⚠️ **法律紅線(唔可以繞)**:交易所**實時**指數要牌照,免費公開 dashboard 唔可以出。
做法:用 **延遲/EOD 源**,UI **必須明寫「延遲 15 分鐘」或「收市價」+ 來源**。
唔准寫「實時」。如要真實時 → 先買牌照,唔係技術問題。

**驗收**:每個指數 card 有 `as-of` 時間戳 + 延遲標示;`validate_config.py` 拒收冇
`delay_minutes` 或 `licence` 欄位嘅財經源。

## P0-E 交通流量分析(新)

**現況**:冇。

**要改**:用兩條真源做「某幾個位置嘅交通流量」
1. **TD Journey Time Indicators (2nd Generation)** — 主要道路 + 過海隧道行車時間估計
   (data.gov.hk `hk-td-sm_8-journey-time-indicators`)→ 做**趨勢線**(同一路段過去 N 小時)
2. **TD 交通快照** + **智慧燈柱實時氣象** — 位置化嘅地面狀況

分析邏輯(規則式,可解釋):路段異常 = 現時行車時間 > 同時段 baseline × 門檻(門檻寫入 config,公開)。
唔准講「AI 預測」。

**驗收**:一個 panel + 一張圖(路段 × 時間);每條判讀可以追返輸入數字。

## P0-F 模式改名(本地化)

**現況**:`醫療模式 / 民生模式 / 直擊模式` — Cyrus 評「有啲奇怪」。

**新名(建議,直接採用)**:
| 舊 | 新 |
|---|---|
| 直擊模式 | **全城脈搏** |
| 醫療模式 | **醫院脈搏** |
| 民生模式 | **街坊事** |
| (交通) | **馬路脈搏** |
| (天氣) | **風雨訊號** |
| (海空) | **海空動態** |
| (金融) | **金融脈搏** |

規則:`脈搏` 系列 = 實時狀態型;`訊號` = 警告型;`事 / 動態` = 事件型。同一家族命名,唔會再有怪名。

## P0-G 搜尋(ID / Name)(舊單未清)

**現況**:只有 `?tab=` / `?layers=` URL 參數,冇搜尋框 — 對應 Cyrus 手寫
「Search ID / Name → no data」。

**要改**:一個搜尋框,跨 **layer / source / panel** 搜:地名、路段、船名/MMSI、航班、
機構名。命中 = (a) map 縮去該幾何,(b) 列出相關 panel 項。
搜唔到 = 明寫「冇資料」+ 顯示實際範圍(唔准靜靜哋乜都唔顯示)。

## P0-H 實時 / 歷史切換(舊單未清)

**現況**:只有時間戳,冇切換。Cyrus 手寫:「實時資訊(實時)／歷史資訊(可勾)」。

**要改**:每個支援時序嘅 panel 加 `現在 / 過去 24h / 過去 7 日`;歷史由已收集嘅
`data/baselines.json` 同 collector 產出讀取,**唔准即場重算**。

## P0-I 修 gate 紅燈(blocking)

**現況(實測,VPS copy)**:
```
python3 scripts/validate_config.py
❌ 1 error(s): · panel analysis_brief: source 'analysis' is not in sources.json
```

⚠️ **修正我之前嘅判斷**:`AGENTS.md` 明講 analysis panel 係 **FED 唔係 FETCHED**
(`FED_PANEL_IDS` in `ui/panels.ts`) —— 「it is a conclusion drawn from the other panels, not a
source. **Do not give it a registry entry or an adapter**」。

所以正確修法係 **令 validator 識得 FED panel**(豁免 `FED_PANEL_IDS`,同時仍然要求佢引用嘅
上游 panel 存在),**唔係**幫佢加一個假 `analysis` source。

**驗收**:`npm run check:all` exit 0(包括 `check:analysis` 10 個 scenario)+
`validate_config.py` 0 error;而且要證明 FED panel 唔會因為豁免而變成「可以指去唔存在嘅嘢」——
加一個負面測試:引用唔存在嘅上游 panel 時 validator 要 fail。


---

## P0-J 新聞多源(已實測,唔准靠估)

**Cyrus 要求**:「新聞我都覺得你應該要揀多幾個 Source」。

**原則(由本次查證得出)**:免費 RSS > keyless 公開 API > 延遲聚合源;**永遠唔加 metered key**。

### ✅ 實測 Work(200 + 真 XML)

| 源 | Feed | 備註 |
|---|---|---|
| RTHK 中文 | `rthk.hk/rthk/news/rss/c_expressnews_{clocal,cgreaterchina,cinternational,cfinance,csport}.xml` | 22 KB 真 RSS;**要跟 301 redirect**(`curl -L`) |
| RTHK 英文 | 同上 `e_expressnews_{elocal,egreaterchina,einternational,efinance}.xml` | 同 pattern |
| 政府新聞網(繁) | `news.gov.hk/tc/categories/{admin,environment,finance,health,infrastructure,law_order}/html/articlelist.rss.xml` | 實測 48 KB ✓ **繁體,合預設語言** |
| 政府新聞網(英) | 同上 `/en/` | 實測 69 KB ✓(現時只用 law_order,遠未用夠) |
| 統計處新聞稿 | `censtatd.gov.hk/data/en/press_release/rss.xml` | ✓ |
| HKMA | `hkma.gov.hk/eng/other-information/rss` 有 feed 列表 | 🟡 要抽實際 endpoint |

→ 合共 **~20 條真 feed**,全部官方/公共廣播,免費 keyless。

### ❌ 實測唔得(唔好嘥時間)

| 源 | 結果 |
|---|---|
| The Standard `thestandard.com.hk/rss.xml` | 200 但回 **HTML,唔係 RSS** ✗ |
| HKFP `hongkongfp.com/feed/` | **403** 擋 bot ✗(要用 proxy + UA,條款另議) |
| Stooq keyless CSV(指數) | **404**,pattern 已失效 ✗ → 指數改用 repo 已有嘅 yahoo proxy path,**唔好加新 provider 除非實測過** |

### 政治紅線 → 呢個做法順手解決

之前 WORK_ORDER 問你「A 保留治安 feed / B 換純交通天氣 / C 保留+聲明」。
**多源之後有第四個更好嘅答案**:**收齊全部官方分類 + 公共廣播(中/英)**,
每條 headline 顯示自己嘅來源 → **定位係聚合器,唔係編輯立場**,比單一 feed 中性得多。

**驗收**:ticker 每條 headline 有來源名 + 時間;每個 feed 有 `licence` / `refresh` / `attribution`;
`validate_config.py` 通過;ticker 唔會因為某一個 feed 死而整體變紅(逐源 degrade)。

---

## P0-K 中港資本流:滬港通 / 深港通 / H 股 / 中概股

**Cyrus 手寫嗰行確認 = 呢個**(港交所、滬港通、中港通、H 股、美股/中概股)。

### ⚠️ 最重要嘅法律事實(實測)

**HKEX 市場數據要轉發授權**:HKEX 官方文件寫明「If you wish to **redistribute** MDF data,
you are required to enter into a **redistribution agreement** with HKEX Information Services」。
→ **公開 dashboard 唔可以轉發港交所實時報價** ✗ 呢個係牌照問題,唔係技術問題。

### ✅ 用 Yahoo Finance(實測 2026-09-30,由數據中心 IP 打通)

**端點(單一,keyless)**:
```
https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1d&interval=1d
```
`meta.regularMarketPrice` / `meta.regularMarketTime` / `meta.currency` → 由 `regularMarketTime`
**算出延遲並顯示**。

**實測 13 個 symbol 全部 200 + 真值**(2026-09-30,DC IP 未被封):

| Symbol | 項目 | 實測 |
|---|---|---|
| `^HSI` | 恒生指數 | 24613.27 HKD ✓ |
| `^HSCE` | 國企指數 | 8220.08 HKD ✓ |
| `000001.SS` | 上證 | 3842.195 CNY ✓ |
| `^N225` | 日經 | 66753.72 JPY ✓ |
| `^GSPC` `^IXIC` `^DJI` | S&P / 納指 / 道指 | 7715.18 / 27057.662 / 51429.43 ✓ |
| `^FTSE` `^GDAXI` | 富時 / DAX | 10638.41 / 25288.94 ✓ |
| `^VIX` | 恐慌指數 | 15.67 ✓ |
| `CNH=X` | 美元兌離岸人幣 | 6.7066 ✓ |
| `GC=F` | 黃金 | 4211.9 ✓ |
| `BTC-USD` | 比特幣 | 83688.85 ✓ |

**法律立場(Cyrus 定:犯法嗰個唔好做)**:
- ✅ **唔做**港交所報價轉發(要 redistribution agreement → 放棄)
- ✅ Yahoo 係**非官方、無文件**嘅端點 → 當**可消失嘅源**處理:**Worker edge cache + 提交快照
  fallback**,死咗就 degrade 做 amber(重用 repo 已有嘅 live-data + 快照機制,**唔好另創**)
- ⚠️ 顯示層寫「**來源:Yahoo Finance(延遲)**」,**唔准**寫成官方交易所數據
- ✅ **HKMA Open API = 法律最乾淨嘅錨**(官方、免費)用嚟做貨幣/利率/銀行業數字

### ⚠️ 中港資本流(滬港通/深港通/H股)點處理

- 唔用港交所報價;**用港交所已發表統計**(ADT 等)當每日引用數字 + 附來源同日期
- H 股 / 中概股 → 用 Yahoo 延遲價(例如 `^HSCE`、個別 ADR symbol),標示延遲
- 唔准拆解/繞過港交所網頁取價

### 絕對唔准

- 唔准將呢類數據寫成「實時」(延遲就寫延遲)
- 唔准拆解/繞過 HKEX 網頁嚟取價(ToS + 會被封)
- 唔准加任何 metered 財經 API(違反 `COST.md`;validator 會 fail)

**驗收**:每張財經 card 有 `as-of` + 延遲標示 + 來源;`validate_config.py` 拒收冇
`delay_minutes` / `licence` 嘅財經源;Stock Connect 數字可以追返港交所發表頁。


---

## P0-L 設計基準:要明顯贏過政府 City Dashboard

**事實(實測/官方)**:政府自己嘅 **City Dashboard**(`data.gov.hk/{tc,en}/city-dashboard`,
例:`?dashboard=traffic`)**2019-12-31 推出**,共四個儀表板。資科辦當時講「以設計思維開發、以人為本」。
Cyrus 評:「設計勁老土同求其、太過簡單」—— 對一個 2019 年產品嚟講,呢個評價成立。

**所以佢係「要贏嘅基準」,唔係抄嘅對象。逐項要贏**:

| 維度 | 政府 City Dashboard | HKCM v0.3 必須做到 |
|---|---|---|
| Panel 系統 | 固定版面、唔可以拖/關 | **可拖、可關、記住位置** |
| 載入 | 開頁即拉 | **lazy load**(P0-B),未開 panel 零 request |
| 手機 | 桌面為主 | **手機可用**(Cyrus 主要用手機睇) |
| 跨源分析 | 冇(各 panel 獨立) | **決定性 brief**(FED panel,Tier 2 timeline + co-occurrence) |
| 主題 | 單一 | **Dark / Light / System** |
| 分享狀態 | 冇 | `?tab=` / `?layers=` **URL 可分享** |
| 來源密度 | 少量 widget | 每 vertical ≥12 可讀項(P0-A) |

⚠️ **唔准抄佢嘅資產**(圖/磚圖/版面) —— 政府數據可以用(附 attribution),但佢嘅圖像/設計唔可以搬。

---

## P0-M 新源驗證規則(兩次踩雷之後加)

**背景**:今次查源,**兩個原本以為可用嘅源原來係凍結/失效**:
- ❌ 智慧燈柱 **LiDAR 快拍影像**:dataset 標題明寫「**數據將不會再更新**」;資源係逐支柱嘅靜態
  JPG(`resource.data.one.gov.hk/opendata/lidar/DF3633.JPG`)→ **唔可以入 real-time panel**
- ⚠️ 智慧燈柱**氣象**數據、TD **Journey Time Indicators**:dataset id 要用**準確形式**先查到

**所以加一條硬規則**:**任何新源註冊之前,必須用 `data.gov.hk` 嘅 CKAN API 查實際 metadata**:

```
https://data.gov.hk/en-data/api/3/action/package_show?id=<dataset-id>
→ result.metadata_modified / result.resources[].url / [].last_modified
```

**准入條件**:
1. `metadata_modified` 要**近**(唔可以係幾年前就冇再動)
2. 資源 URL 要**真係回應 200** 而且係**動態**(唔係一張固定 JPG)
3. 標題/描述**冇「數據將不會再更新」**字眼
4. 通過 → 入 `sources.json`,帶齊 `licence` / `refresh` / `attribution`

**規模參考**:政府自稱開放數據平台有 **5,600+ 數據集、2,400+ API**(smartcity.gov.hk)。
即係問題**唔係冇數據,而係揀得準** —— 所以「Source 唔全面」要用呢個方法逐個驗返,唔係靠感覺加。

**驗收**:新增每個源都貼出 CKAN 查詢結果(metadata_modified + URL 回應);`validate_config.py` 通過。

---

## 完成定義(Definition of Done)

0. **live bundle hash == PC build hash**(見 P0-0;唔對就唔算做完)
1. `npm run typecheck` + `npm run check:all` **exit 0**(貼原文輸出;包括 `check:livewall`、
   `check:layout`、`check:analysis`、`check:quota`)
   ⚠️ 唔准用截斷輸出「睇落有無錯」嚟判斷(Pitfall 40:silence 讀成 pass)—— 用 exit code
2. 規模指標:用 `npm run measure:boot` 證明 lazy chunk **冇入 critical path**
2. **真 DOM audit**(VPS 側做,唔靠截圖自報):panel 可拖/可關、stream dock 同時多 tile、map 未被遮
3. **Network log 證據**:lazy load 生效 — 未開 panel 零 request
4. 每個新源有 `licence` / `refresh` / `attribution`;財經源有 `delay_minutes`
5. 冇 LLM、冇 modal 蓋畫面、冇「實時」字眼用於延遲數據
6. Deploy:由 **PC 側** `npx wrangler pages deploy dist`(實測 `git push` **唔會**出街),
   部署後貼出新 bundle hash;VPS 側用 hash 對版本

## 環境事實(唔好再踩)

- PC clone:`C:\hk-city-monitor`;build 喺 PC,**唔喺 VPS**
- 部署憑證:`%APPDATA%\xdg.config\.wrangler\config\default.toml`
- Worker:白名單 proxy;新增上游必須同時加 path,否則 400
- VPS 側 copy 只用嚟 QA/audit,唔好當生產

---

## ⚡ P0-0 已答(Cyrus PC 真 GPU 瀏覽器實測 · 2026-10-01)

**答案:live 係舊版,而且係「冇 build 過」**

- live bundle = **`index-BYNmrnpE.js`**(實測 3 次都係同一個)
- PC 上 `C:\hk-city-monitor` 有 **3 個更新嘅 commit**:
  `feat(freight): live berth vacancy + collectors and publisher` ·
  `feat(aircraft): live ADS-B traffic restored, collected on the PC` ·
  `chore: drop two screenshot artifacts`
- **PC 冇 `dist/`** → 即係 `wrangler pages deploy dist` 冇嘢好傳 → **live 停留喺 09-28 之前**
- ⚠️ 前端係讀**跟 deploy 一齊出嘅 `/data/*.json`**(panels/verticals/layers/sources/rules/cameras),
  RSS 經 Worker(`hk-city-monitor.cyrus738.workers.dev/proxy?url=…`)→ **deploy 舊 = 面板定義同來源清單都一齊舊**

**即刻要做(得 Cyrus 部 PC 做得到)**:`npm run build` → `npx wrangler pages deploy dist`

### live DOM 審核(同一次,讀真 DOM 唔係睇圖)

| 量度 | 實測 |
|---|---|
| 地圖 | canvas **1064×819** 正常 render ✓(真 GPU) |
| 版面 | 右欄 x=1120、w=480 → **地圖左 + 面板右**,唔係可拖浮窗 |
| `.panel` 數 | 19(一個 scroll 容器 scrollH 4059 / cliH 737 = 預期) |
| 狀態列 | 「覆蓋:**6–7/17** 個面板來源正常 · **1 個過期** · 目錄共 **180 個源**」 |
| 唯一標 `is-stale` | **「香港上空航班(社群 ADS-B)」** ← repo 已有修復,只係未 deploy |
| ⚠️ 未解 | 17 個面板中得 6–7 個「正常」→ **約 10 個係未知狀態**,要查 |
| 模式 | 總覽 · 相機 · 颱風模式 · 口岸模式 · 停水模式 · 天氣模式(新聞 chip:全部/本地/國際/兩岸/財經/體育) |
| console 錯誤 | `InvalidStateError: The source image could not be decoded` ← **有一張圖解碼失敗** |

### 🎥 直播行為 —— 你嘅投訴**喺呢個 bundle 重現唔到**

實測:切去「相機」模式 → 撳第一個相機 tile →

- `iframe` 由 0 → **1**,src = `youtube.com/embed/…?autoplay=1&mute=1&playsinline`
- **`modal_open: false`** → **係喺 tile 裏面播,冇開 popup、冇遮右邊**

即係「縮埋一舊 / 撳落去遮晒右邊」係**舊 bundle 嘅行為**。仍然要做嘅係 P0-C 嘅**同時開幾個 + 可拖可關**。

### 追加(2026-10-01 晚,PC GPU 瀏覽器 + 真排程查證)

**① 「6–7/17 面板正常」—— 唔係 bug,係 lazy load 正常運作** ✓
用 app 自己嘅 `data-state` 逐個讀:未捲動時 **8 live · 1 stale · 9 loading**;
捲到面板欄底部之後 → **15 live · 3 stale · 0 loading**,覆蓋升到 **14/17**。
即係 fold 以下嘅面板 on-scroll 才 fetch —— **P0-B(lazy load)其實已經有**,唔使再起。
(一度以為「~10 個面板未知狀態」= 壞,係我睇漏 scroll;呢點要記錄,免得畀人當 defect 修。)

**② 3 個 stale 面板(實測)**
`香港上空航班(社群 ADS-B)` · `港股(延遲報價)` · **`臨時停水通知`**(產品第一個 vertical)

**③ 根因:collector 全部正常,但冇「發佈」呢一步** ✗✗
- PC 排程 4 個,今日全部 result 0、正常跑:
  `HKCM aircraft collector (2 min)` · `baseline (hourly)` · `berth vacancy (10 min)` · `water suspension (10 min)`
- **`live-data` 分支最後 commit = 2026-09-29T15:12Z(兩日前)** → 即係收集冇問題,但**冇人 push 上去**
- 排程表 546 個 task,action 含 collector/live/publish 嘅**只有 4 個,冇 publisher** → 發佈步驟從來未排程
- 前端照設計 degrade 做 amber ✓(唔係扮 live)但面板就長期滯後

**要做**:把 `scripts/live_cycle.sh`(collect + publish)嘅 **publish 半邊**排程(5–10 分鐘一次),
同 `feat(freight)… the collectors and publisher that were blocked on manual steps` 對齊。
未做之前,航班／停水／泊位三個面板會一直 stale。

**④ 其他實測**:`window.__hkcm` hooks 齊 ✓ · worker 連到 ✓ · cameras {td: 1013, hko: 34} ·
map 12 層 · 19 個 mounted panel / 18 個 overview · tabs 10 個 group ·
`analysis_brief` 嘅 `source: 'analysis'` **仍然係孤兒**(panel 由 FED 資料渲染所以顯示 live,
但 registry/validator 仍會 flag)

### 更正 + 已修(2026-10-01 晚)⚠️ 我早前嘅建議係錯嘅

**錯嘅建議**:叫 Cyrus 喺 **PC** 加 publish 排程。
**正確**(出自你自己嘅 `scripts/live_cycle.sh` 檔頭):*「The PC could collect but **not authenticate**,
which is what left every reading sitting in a working copy that nothing published.」*
→ **PC 收得到但冇 push 憑證;VPS 兩樣都有**。所以發佈一定要喺 **VPS** 跑。

**實測確認兩邊都冇做發佈**:
- PC:4 個 collector 排程今日全部 result 0、正常跑 ✓ 但**冇任何 publisher task**
- VPS:**有** push 憑證(`git push --dry-run --force origin HEAD:refs/heads/live-data` → `+ b1274e2...9b2d713 forced update` ✓)
  但 **crontab 冇 live_cycle** ✗
- 結果:`live-data` 分支 freeze 喺 **2026-09-29T15:12Z** → 航班／停水／泊位三個面板長期 amber

**已跑一次(2026-10-01 17:12 HKT)**:`cd /home/admin/hkcm-live && sh scripts/live_cycle.sh`
```
OK   aircraft.json        40,328 B   70 aircraft with a position   from api.adsb.lol
OK   berth_vacancy.json   45,055 B   120 berths  vacant=27 in_use=93  as at 2026-10-01 17:12 HKT
OK   water_suspension.json 77,312 B  active: 3  districts: 17
OK   pushed 3 file(s) to live-data
```
分支 commit → **2026-10-01T09:12:56Z** ✓;raw 檔已新(`water_suspension.generated = 2026-10-01T17:12:55+08:00`)

**兩個操作細節(下次唔好中招)**
1. 三個檔案喺分支 **root**,唔係 `data/`:`https://raw.githubusercontent.com/Cyruschu430/hk-city-monitor/live-data/<file>`
   (`lib/sources.ts:145 LIVE_BASE` 就係呢個) —— **驗證用錯路徑會 404,睇落似「push 失敗」**
2. raw.githubusercontent 送 **`cache-control: max-age=300`** → 發佈之後**最多 5 分鐘**先喺瀏覽器見到,
   唔好喺 5 分鐘內見到舊數就當失敗

**要令佢變常態(得 VPS 做得到)**,一行 cron:
```
*/5 * * * * cd /home/admin/hkcm-live && /bin/sh scripts/live_cycle.sh >> /tmp/live_cycle.log 2>&1
```
**未安裝** —— 呢個係行為改變(每 5 分鐘 force-push 一次),等 Cyrus 講聲。

**PC 側 4 個 collector 排程而家係多餘嘅**(收完冇人發佈);可以留(已有 run_hidden.vbs 唔會閃窗),
但要知道佢哋唔會令 live 更新。

### 追加 2 —— 點解 push 完仍然 stale?(算式,唔係感覺)

`lib/honesty.ts`:`quietSeconds(cadence)` = **2 × cadence** 就係該面板嘅容忍窗口。
再撞上 raw.githubusercontent 嘅 **`cache-control: max-age=300`**(瀏覽器最多遲 5 分鐘才見到新檔)。

| 檔案 | registry cadence | 容忍窗口 | 發佈後「睇落 live」嘅實際時間 |
|---|---|---|---|
| `wsd_water_suspension` | `5 minutes` | **10 分鐘** | 10 − 5 = **約 5 分鐘** |
| `hk_berth_vacancy` | `every 10 minutes (PC collector)` | 20 分鐘 | 約 15 分鐘 |
| `adsb_lol_hk` | `every 2 minutes (PC collector)` | **4 分鐘** | **永遠唔夠** ✗ |

→ 我 17:12 push、17:22 之後查 → 水嘅 10 分鐘窗口已過 → **顯示 stale 完全正確**,唔係 bug。
→ **`香港上空航班` 每次都 stale 就係呢條算式**:容忍 4 分鐘 < CDN 遲 5 分鐘 → 由設計上永遠追唔到,
無論 collector 跑得幾密。

**所以要做兩件(唔同一件事)**
1. **VPS 加 cron 每 2 分鐘**(覆蓋水 10 分鐘 + 泊位 20 分鐘窗口):
   ```
   */2 * * * * cd /home/admin/hkcm-live && /bin/sh scripts/live_cycle.sh >> /tmp/live_cycle.log 2>&1
   ```
2. **航班面板另要修一處**:佢嘅容忍窗口細過 CDN 快取期,兩個做法(二選一):
   - (a) 把 `adsb_lol_hk` 嘅 `cadence` 改成反映**瀏覽器實際攞得到**嘅頻率(唔係 collector 嘅頻率),例如 `5 minutes`;
   - (b) 喺 live URL 加版本參數(`…/live-data/aircraft.json?v=<發佈時間戳>`)繞過 CDN 快取 —— app 本身已解析檔案內嘅時間戳
     (`lib/sources.ts` 註解寫明 water 用 `generated`、berth 逐個 `LastUpdate`),所以加 version 唔會影響 honesty 判斷。
   **唔改就等於個面板長期掛 amber** —— 對評審係「有個源壞咗」嘅觀感。

### 追加 3 —— ⚠️ 我頭先「追加 2」嘅結論係**錯嘅**,呢個先係真根因

**硬證據(PC 真 Chrome,捲到底、cache 停用)**:
```
performance.getEntriesByType('resource')
  → 打 raw.githubusercontent 嘅請求:**0 個** ✗✗
  → 實際讀:pages.dev/data/{panels,verticals,layers,sources,rules,cameras_hko}.json
```
**即係 live 版根本冇讀 `live-data` 分支** —— 佢讀嘅係**部署包內嘅舊快照**。

### 為咩會咁

`lib/sources.ts` 嘅 `LIVE_BASE`(讀 live-data 分支)係**較新嘅 commit 才加**嘅;
而 live 版仲係 **`index-BYNmrnpE.js`** —— 一個**早過呢個功能**嘅 bundle。
所以:
- 我 push 三次落 `live-data`(檔案層面確認新 ✓)—— **瀏覽器一次都冇讀過** ✗
- 三個面板 amber,唔係 cadence 窗口問題,係**佢哋根本冇資格變 live**(讀緊 09-28 之前嘅快照)
- 同一時間,`feat(aircraft) ADS-B 修復`、`feat(freight)`、live wall 改動全部**未出街** = 同一個根因

### 所以次序係:**先 deploy,後 cron**

| 次序 | 做咩 | 為咩 |
|---|---|---|
| **1** | PC:`cd web && npm run build` → `npx wrangler pages deploy dist --project-name=hk-city-monitor --branch=main --commit-dirty=true` | 令 live bundle 識得讀 `live-data`;順便出街 aircraft/freight/live-wall |
| **2** | 驗證:live 頁 `performance` 出現 **raw.githubusercontent 請求** | 呢個係「live 分支已被讀取」嘅唯一證據 |
| **3** | VPS 加 cron 每 2 分鐘跑 `scripts/live_cycle.sh` | 之後面板才保持 live |

**如果先加 cron = 做白工**(冇人讀個分支)。

### 撤回:cadence 算式唔係今次嘅成因

「追加 2」講嘅 `quietSeconds = 2 × cadence`、水 10 分鐘窗口、航班 4 分鐘窗口 —— 機制**真實存在**
(`lib/honesty.ts`),但**唔係今日三個面板 amber 嘅原因**(佢哋連 live 分支都冇讀)。
⚠️ **deploy 之後要再驗一次**:到時航班面板有機會因「4 分鐘容忍 < 5 分鐘 CDN 快取」而仍然 amber,
咁就要處理「追加 2」嗰兩個做法(改 cadence 字串 或 live URL 加版本參數)。
