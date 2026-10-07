#!/usr/bin/env python3
"""build_fuel.py — Consumer Council fuel prices, scraped from the public site."""
import json
import re
import urllib.request

URL = "https://oil-price.consumer.org.hk/tc/price"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

req = urllib.request.Request(URL, headers=UA)
html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")

# Each product block: company name + list of prices (retail, discounted)
blrs = re.findall(r'<div class="blr[^"]*".*?</div></div></div></div></div>', html, re.DOTALL)
out = []
for b in blrs:
    name_m = re.search(r"<strong>(.*?)</strong>", b)
    prices = re.findall(r"\$([0-9.]+)/升", b)
    if name_m and prices:
        name = name_m.group(1).replace("&amp;", "&")
        retail = float(prices[0]) if len(prices) > 0 else None
        discounted = float(prices[1]) if len(prices) > 1 else None
        out.append({
            "name": name,
            "retail": retail,
            "discounted": discounted,
            "discount": round(retail - discounted, 2) if retail and discounted else None,
        })

with open("data/fuel_prices.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print(f"fuel: {len(out)} products -> data/fuel_prices.json")
