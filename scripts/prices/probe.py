"""Reachability probe for price sources, run from GitHub Actions runners (round 5)."""

from __future__ import annotations

import json
import re
import ssl
import sys
import urllib.error
import urllib.request

UA = "FoodoPriceBot/0.1 (+https://github.com/Lucky2356/Foodo; prices for a free meal planner)"


def fetch(url: str, ctx: ssl.SSLContext | None = None) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ru"})
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as r:
            return r.status, r.read(6_000_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:  # noqa: BLE001
        return -1, f"{type(e).__name__}: {e}"


def ld(html: str) -> list:
    out = []
    for block in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S):
        try:
            out.append(json.loads(block))
        except ValueError:
            out.append({"_raw": block[:300]})
    return out


def main() -> int:
    ctx = ssl.create_default_context()
    for url in ["https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt", "http://nuc-cdp.digital.gov.ru/cdp/subca_ssl_rsa2024.crt"]:
        status, pem = fetch(url)
        print("CA", url, status, len(pem))
        if "BEGIN CERTIFICATE" in pem:
            ctx.load_verify_locations(cadata=pem)
    status, page = fetch("https://rosstat.gov.ru/statistics/price", ctx)
    print("ROSSTAT price page:", status, len(page))
    for m in re.finditer(r'href="([^"]+\.(?:xlsx?|zip|csv|docx?))"', page):
        start = max(0, m.start() - 400)
        title = re.sub(r"<[^>]+>", " ", page[start:m.start()])
        print("  FILE", m.group(1), "|", re.sub(r"\s+", " ", title)[-200:])
    status, robots = fetch("https://rosstat.gov.ru/robots.txt", ctx)
    print("ROSSTAT robots:", status, robots[:800])

    status, idx = fetch("https://magnit.ru/sitemap_index.xml")
    maps = re.findall(r"<loc>([^<]+)</loc>", idx)
    print("\nMAGNIT sitemap index:", status, maps[:30])
    for sm in [m for m in maps if "catalog" in m or "categor" in m][:2]:
        status, body = fetch(sm)
        locs = re.findall(r"<loc>([^<]+)</loc>", body)
        print("  ", sm, status, len(locs), locs[:40])
        for url in [l for l in locs if re.search(r"/catalog/\d+", l)][:2]:
            status, html = fetch(url)
            for d in ld(html):
                if isinstance(d, dict) and d.get("@type") == "OfferCatalog":
                    items = d.get("itemListElement", [])
                    print(f"    CATEGORY {url} {status}: {len(items)} offers")
                    for o in items[:12]:
                        print("      ", o.get("name"), "|", o.get("price"), "|", o.get("url"))

    status, html = fetch("https://vkusvill.ru/goods/ovoshchi-frukty-yagody-zelen/")
    print("\nVKUSVILL", status, len(html))
    for d in ld(html)[:3]:
        print("  LD:", json.dumps(d, ensure_ascii=False)[:2500])
    cards = re.findall(r'href="(/goods/[a-z0-9\-]+-\d+\.html)"', html)
    print("  product links:", len(set(cards)), sorted(set(cards))[:10])
    subs = sorted(set(re.findall(r'href="(/goods/[a-z0-9\-]+/(?:[a-z0-9\-]+/)?)"', html)))
    print("  category links:", subs[:60])
    return 0


if __name__ == "__main__":
    sys.exit(main())
