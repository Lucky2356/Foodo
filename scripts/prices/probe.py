"""Reachability probe for price sources, run from GitHub Actions runners (round 4)."""

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


def offers(html: str) -> list[dict]:
    out = []
    for block in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        if isinstance(data, dict) and data.get("@type") == "OfferCatalog":
            out += data.get("itemListElement", [])
    return out


def main() -> int:
    status, robots = fetch("https://magnit.ru/robots.txt")
    print("MAGNIT ROBOTS FULL:\n", robots[:6000])
    status, html = fetch("https://magnit.ru/catalog/")
    links = sorted(set(re.findall(r'href="(https://magnit\.ru/catalog/[^"?#]+)"', html)))
    print(f"MAGNIT catalog links ({len(links)}):", links[:120])
    for url in [l for l in links if re.search(r"/catalog/\d+", l)][:3]:
        status, page = fetch(url)
        items = offers(page)
        print(f"\nCATEGORY {url} -> {status}, {len(items)} offers")
        for o in items[:15]:
            print("   ", o.get("name"), "|", o.get("price"))
        sub = sorted(set(re.findall(r'href="(https://magnit\.ru/catalog/[^"?#]+)"', page)))
        print("   sublinks:", sub[:40])
    status, vv = fetch("https://vkusvill.ru/goods/ovoshchi-frukty-yagody-zelen/")
    print(f"\nVKUSVILL -> {status}, {len(vv)} chars:", re.sub(r"\s+", " ", vv[:800]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
