#!/usr/bin/env python3
"""Generate ATTRIBUTION.md from sources.json.

Why generated: the attribution duty is a FACT about each source, and sources.json
is where a source is declared. A hand-kept attribution list drifts the moment a
source is added — and the HKSAR open-data terms require the attribution, so a
drift is a licence breach, not a cosmetic problem.

The 10 sources with no `license` are listed separately and marked as unverified.
scripts/apply_licenses.py leaves them blank on purpose ("a wrong licence is worse
than none"); this file must show that gap rather than hide it behind a heading.

Run:  python scripts/build_attribution.py
"""
from __future__ import annotations

import io
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "sources.json"
OUT = ROOT / "ATTRIBUTION.md"


def main() -> int:
    data = json.loads(io.open(SRC, encoding="utf-8").read())
    sources = data["sources"] if isinstance(data, dict) else data

    by_licence: dict[str, list[dict]] = defaultdict(list)
    unverified: list[dict] = []
    for s in sources:
        lic = s.get("license")
        if lic:
            by_licence[lic].append(s)
        else:
            unverified.append(s)

    total = len(sources)
    lines: list[str] = []
    w = lines.append

    w("# 出處與授權 · Attribution")
    w("")
    w("本項目顯示嘅每一項數據都屬其出版者，並按以下條款使用。**香港政府部門嘅開放數據須標明出處**，")
    w("所以呢個檔案係授權要求，唔係禮貌。")
    w("")
    w("> 由 `scripts/build_attribution.py` 從 `sources.json` **自動生成** —— 唔好手改。")
    w("> 加源之後跑一次就得，咁文件同程式就唔會講唔同嘅嘢。")
    w("")
    w("## 統計")
    w("")
    w(f"- 源總數：**{total}**")
    w(f"- 已確認授權：**{total - len(unverified)}**")
    w(f"- 未確認（故意留空）：**{len(unverified)}**")
    w("")
    w("## 授權一覽")
    w("")
    for lic in sorted(by_licence, key=lambda k: (-len(by_licence[k]), k)):
        w(f"### {lic}")
        w("")
        w(f"{len(by_licence[lic])} 個源。")
        w("")
        w("| 源 | 名稱 | 網址 |")
        w("|---|---|---|")
        for s in sorted(by_licence[lic], key=lambda x: x["id"]):
            name = (s.get("name") or "").replace("|", "／")
            url = s.get("url") or ""
            url_cell = f"[link]({url})" if url.startswith("http") else (url or "—")
            w(f"| `{s['id']}` | {name} | {url_cell} |")
        w("")

    w("## 未確認授權")
    w("")
    w("`scripts/apply_licenses.py` 刻意留空呢啲 —— **錯嘅授權比冇授權更差**。")
    w("要用之前需要人手核對該出版者自己嘅條款。")
    w("")
    w("| 源 | 出版者／主機 | 名稱 |")
    w("|---|---|---|")
    from urllib.parse import urlparse

    for s in sorted(unverified, key=lambda x: x["id"]):
        host = urlparse(s.get("url") or "").hostname or "（無 URL）"
        name = (s.get("name") or "").replace("|", "／")
        w(f"| `{s['id']}` | {host} | {name} |")
    w("")
    w("## 底圖與地名")
    w("")
    w("- 地圖底圖及地名標籤：**地圖來自地政總署**（Lands Department）")
    w("- 航拍影像、三維數碼地圖：地政總署")
    w("- 備選底圖：© OpenStreetMap contributors（ODbL）、© CARTO")
    w("")
    w("## 本項目自身")
    w("")
    w("- 程式碼：**AGPL-3.0-only**，見 `LICENSE`")
    w("- 架構概念參考 [World Monitor](https://github.com/koala73/worldmonitor)（AGPL-3.0，作者 Elie Habib）。")
    w("  本項目為獨立項目，並非 World Monitor 官方產品。")
    w("- 與香港特別行政區政府（包括其「AI 城市大腦」計劃）**無任何關係**。")
    w("")

    text = "\n".join(lines)
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(text)
    print("wrote %s: %d bytes, %d licences, %d unverified" % (OUT.name, len(text.encode("utf-8")), len(by_licence), len(unverified)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
