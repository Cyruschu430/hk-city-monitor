# HK City Monitor · 香港城市監察

香港本土實時態勢儀表板。**全開源（AGPL-3.0）**。

一版睇齊香港：官方交通快拍、天文台天氣攝影機、天氣警告、口岸情況、飛機、船隻、交通、
停車場、康文署設施同活動、市場數據 —— 全部公開數據，可以 filter 到香港範圍嘅就接入嚟。

> **宗旨：數據嘅廣泛性、開放性、公開度 —— OSINT 就係要推動呢樣嘢。**
> 每個數字都連得返去源頭，用戶可以自己驗證。

參考架構：[World Monitor](https://github.com/koala73/worldmonitor)（AGPL-3.0）。
本項目係獨立項目，**唔係** World Monitor 官方產品，亦同香港特區政府（包括其「AI城市大腦」
計劃）**無任何關係**。

## 現況

v0.1 原型已經上線：**1013 個運輸署交通快拍 + 34 個天文台天氣攝影機**（全部免 API key）、
天氣警告、本港現況、延遲市場報價、可釘相機牆、YouTube 直播。

## 文件

| 檔案 | 內容 |
|---|---|
| `TECH_SPEC.md` | **全部已實測數據源清單**（endpoint、更新頻率、要唔要 key、狀態 🟢🟡🔴）＋ 法律界線 |
| `DESIGN_BRIEF.md` | 視覺契約（design token、排版、動態預算、誠實狀態、驗收清單） |
| `AGENTS.md` | 開發代理指示（stack、目錄、逐個 run 嘅範圍同驗收條件、已知陷阱） |

## 快速開始

```bash
# 1. 重建相機資料（官方清單 → 靜態 JSON）
python3 scripts/build_cameras.py

# 2. 睇 v0.1 原型（任何靜態伺服器）
python3 -m http.server 8000
```

v0.2 應用程式喺 `web/`（Vite + TypeScript）。開發：

```bash
cd web && npm install && npm run dev
```

## 數據來源

所有數據來自香港政府及其他公開來源。請參閱 `TECH_SPEC.md` 逐項列出嘅出處、
更新頻率同授權。**本項目唔轉載媒體內容**，新聞只出標題同連結。

- 運輸署 交通快拍圖像（[DATA.GOV.HK](https://data.gov.hk/tc-data/dataset/hk-td-tis_2-traffic-snapshot-images)）
- 香港天文台 天氣攝影機及[開放數據 API](https://data.weather.gov.hk/weatherAPI/doc/HKO_Open_Data_API_Documentation_tc.pdf)
- 地圖底圖 © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors · © [CARTO](https://carto.com/attributions)

## 授權

AGPL-3.0-only。基於 [World Monitor](https://github.com/koala73/worldmonitor)（作者 Elie Habib）
嘅架構概念建立；本項目使用獨立品牌。
