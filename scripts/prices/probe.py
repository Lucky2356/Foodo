"""Reachability probe for price sources, run from GitHub Actions runners (round 3: page structure)."""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request

UA = "FoodoPriceBot/0.1 (+https://github.com/Lucky2356/Foodo; prices for a free meal planner)"


def fetch(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ru"})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, r.read(4_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:  # noqa: BLE001
        return -1, f"{type(e).__name__}: {e}"


def ld_blocks(html: str) -> list[str]:
    return re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S)


def show(url: str, link_re: str) -> list[str]:
    status, html = fetch(url)
    print(f"\n=== {url} -> {status}, {len(html)} chars")
    for i, b in enumerate(ld_blocks(html)[:4]):
        print(f"--- ld+json #{i}: {b.strip()[:1800]}")
    links = sorted(set(re.findall(link_re, html)))
    print(f"--- {len(links)} links: {links[:80]}")
    return links


def main() -> int:
    vv = show("https://vkusvill.ru/goods/ovoshchi-frukty-yagody-zelen/", r'href="(/goods/[a-z0-9\-/]+)"')
    products = [l for l in vv if l.endswith(".html")]
    if products:
        show("https://vkusvill.ru" + products[0], r'href="(/goods/[a-z0-9\-/]+)"')
    status, html = fetch("https://vkusvill.ru/goods/ovoshchi-frukty-yagody-zelen/")
    for m in list(re.finditer(r'(ProductCard__weight|weight|Вес|кг|/шт)', html))[:5]:
        print("VV context:", html[max(0, m.start() - 200): m.start() + 200].replace("\n", " "))

    mg = show("https://magnit.ru/catalog/", r'href="(/catalog/[^"?#]+)"')
    status, html = fetch("https://magnit.ru/catalog/")
    for key in ["storeCode", "storeId", "cityName", "city", "shopCode", "Москва", "region"]:
        i = html.find(key)
        if i >= 0:
            print(f"MG [{key}]:", html[max(0, i - 150): i + 250].replace("\n", " "))
    cats = [l for l in mg if re.match(r"/catalog/\d+", l)]
    if cats:
        show("https://magnit.ru" + cats[0], r'href="(/product/[^"?#]+)"')
    return 0


if __name__ == "__main__":
    sys.exit(main())
