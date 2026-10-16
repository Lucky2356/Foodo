"""Reachability probe for price sources, run from GitHub Actions runners (round 2).

Rosstat sites use the Russian Trusted Root CA (Минцифры), which is not in public trust stores; the
probe downloads it from the official Gosuslugi address and adds it to a dedicated SSL context."""

from __future__ import annotations

import re
import ssl
import sys
import urllib.error
import urllib.request

UA = "FoodoPriceBot/0.1 (+https://github.com/Lucky2356/Foodo; prices for a free meal planner)"
CA_URLS = [
    "https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt",
    "https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt",
]


def fetch(url: str, ctx: ssl.SSLContext | None = None, limit: int = 3_000_000) -> tuple[int, str, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ru"})
    try:
        with urllib.request.urlopen(req, timeout=25, context=ctx) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read(limit)
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Server", ""), b""
    except Exception as e:  # noqa: BLE001
        return -1, f"{type(e).__name__}: {e}", b""


def robots_star(body: bytes) -> str:
    """The rules of the `User-agent: *` group, compacted."""
    out, active = [], False
    for line in body.decode("utf-8", "replace").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        key, _, value = line.partition(":")
        key, value = key.strip().lower(), value.strip()
        if key == "user-agent":
            active = value == "*"
        elif active:
            out.append(f"{key}:{value}")
    return " | ".join(out)[:1500]


def main() -> int:
    ctx = ssl.create_default_context()
    for url in CA_URLS:
        status, ctype, body = fetch(url)
        print(f"CA {url} -> {status} {ctype} {len(body)}B")
        if status == 200 and b"BEGIN CERTIFICATE" in body:
            ctx.load_verify_locations(cadata=body.decode())
    for url in [
        "https://rosstat.gov.ru/statistics/price",
        "https://rosstat.gov.ru/robots.txt",
        "https://showdata.gks.ru/report/278930/",
        "https://rosstat.gov.ru/opendata",
    ]:
        status, ctype, body = fetch(url, ctx)
        text = body.decode("utf-8", "replace")
        links = sorted(set(re.findall(r'href="([^"]+\.(?:xlsx?|csv|zip))"', text)))
        print(f"{url} -> {status} {ctype} {len(body)}B; files: {links[:40]}")
        if "robots" in url:
            print("  robots *:", robots_star(body))
        for m in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*>([^<]*(?:цен|Цен)[^<]*)</a>', text):
            print("  link:", m.group(1), "|", m.group(2).strip()[:120])
    for site in ["https://magnit.ru", "https://lenta.com", "https://vkusvill.ru", "https://www.auchan.ru", "https://online.metro-cc.ru", "https://monetka.ru"]:
        status, _, body = fetch(site + "/robots.txt")
        print(f"ROBOTS {site}: {robots_star(body)}")
    for url in [
        "https://vkusvill.ru/goods/ovoshchi-frukty-yagody-zelen/",
        "https://online.metro-cc.ru/category/ovoshchi-i-frukty",
        "https://www.auchan.ru/catalog/ovoshchi-frukty-zelen-griby-yagody/",
        "https://magnit.ru/catalog/",
        "https://lenta.com/catalog/frukty-i-ovoshchi-17818/",
        "https://monetka.ru/catalog/",
    ]:
        status, ctype, body = fetch(url)
        text = body.decode("utf-8", "replace")
        markers = {k: (k in text) for k in ["__NEXT_DATA__", "__NUXT__", "application/ld+json", 'itemprop="price"', "window.__INITIAL_STATE__", "data-price"]}
        prices = re.findall(r'(?:"price"|itemprop="price"[^>]*content=)\s*[:=]?\s*"?(\d+(?:[.,]\d+)?)', text)[:8]
        title = re.search(r"<title>([^<]*)</title>", text)
        print(f"PAGE {url} -> {status} {ctype} {len(body)}B title={title.group(1)[:80] if title else None} markers={markers} prices={prices}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
