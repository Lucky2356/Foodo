"""Reconnaissance of chain websites before a collector is written (run in GitHub Actions only).

    python -m scripts.prices.probe lenta auchan metro monetka

For each site it prints what robots.txt allows, the sitemaps it declares, a few catalogue URLs and,
for one catalogue page, which machine-readable price formats it carries (schema.org JSON-LD,
microdata, Next.js/Nuxt state). Nothing is written: the output is read from the job log to decide
whether and how a chain can be collected honestly (public pages, robots.txt respected)."""

from __future__ import annotations

import gzip
import http.cookiejar
import re
import sys
import urllib.error
import urllib.request

from .common import USER_AGENT, Fetcher, FetchError

SITES = {
    "lenta": "https://lenta.com",
    "auchan": "https://www.auchan.ru",
    "metro": "https://online.metro-cc.ru",
    "monetka": "https://monetka.ru",
}

CATALOGUE_HINT = re.compile(
    r"/(catalog|product|katalog|goods|category|c)/", re.IGNORECASE
)


def text_of(raw: bytes) -> str:
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8", "replace")


def locs(xml: str) -> list[str]:
    return re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml)


def describe_page(html: str) -> list[str]:
    out = []
    ld = re.findall(
        r"<script[^>]+application/ld\+json[^>]*>(.*?)</script>", html, re.DOTALL
    )
    types = sorted(
        {t for block in ld for t in re.findall(r'"@type"\s*:\s*"([^"]+)"', block)}
    )
    out.append(f"  JSON-LD blocks: {len(ld)} types: {types[:15]}")
    microdata = len(re.findall(r"itemprop=[\"']price[\"']", html))
    out.append(f"  microdata offers: {microdata}")
    for marker in (
        "__NEXT_DATA__",
        "__NUXT__",
        "window.__INITIAL_STATE__",
        "__APOLLO_STATE__",
        "__PRELOADED_STATE__",
    ):
        if marker in html:
            out.append(f"  state marker: {marker}")
    prices = re.findall(r'"price"\s*:\s*"?([\d.,]+)', html)
    out.append(f"  'price' fields: {len(prices)} sample: {prices[:5]}")
    names = re.findall(r'"name"\s*:\s*"([^"]{4,80})"', html)
    out.append(f"  'name' samples: {names[:6]}")
    weights = re.findall(r"(\d+(?:[.,]\d+)?)\s?(г|кг|мл|л|шт)\b", html)
    out.append(f"  weight-like tokens: {len(weights)} sample: {weights[:6]}")
    out.append(f"  html size: {len(html)}")
    return out


def probe(name: str, base: str) -> None:
    print(f"===== {name} {base}")
    f = Fetcher(base, delay=3, timeout=30)
    try:
        robots = f._open(base + "/robots.txt", 500_000).decode("utf-8", "replace")
    except FetchError as e:
        print(f"robots.txt: {e}")
        return
    f.rules = None
    from .common import robots_rules

    f.rules = robots_rules(robots)
    print(f"robots.txt rules for *: {len(f.rules)}")
    for allow, pattern in f.rules[:60]:
        print(f"  {'Allow' if allow else 'Disallow'}: {pattern}")
    sitemaps = re.findall(r"(?im)^sitemap:\s*(\S+)", robots)
    print(f"sitemaps: {sitemaps[:10]}")
    urls: list[str] = []
    for sm in sitemaps[:3]:
        try:
            xml = text_of(f.get(sm, 20_000_000))
        except FetchError as e:
            print(f"  {sm}: {e}")
            continue
        found = locs(xml)
        print(f"  {sm}: {len(found)} locs, sample {found[:5]}")
        children = [u for u in found if u.endswith((".xml", ".xml.gz"))]
        for child in children[:4]:
            try:
                sub = locs(text_of(f.get(child, 20_000_000)))
            except FetchError as e:
                print(f"    {child}: {e}")
                continue
            print(f"    {child}: {len(sub)} locs, sample {sub[:4]}")
            urls.extend(sub)
        urls.extend(u for u in found if not u.endswith((".xml", ".xml.gz")))
    catalogue = [u for u in urls if CATALOGUE_HINT.search(u)]
    print(f"catalogue-like urls: {len(catalogue)} sample {catalogue[:8]}")
    for url in catalogue[:2] or [base + "/"]:
        allowed = f.rules is not None
        try:
            html = f.text(url)
        except FetchError as e:
            print(f"page {url}: {e}")
            continue
        print(f"page {url} (robots ok={allowed})")
        for line in describe_page(html):
            print(line)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: object, **kwargs: object) -> None:  # type: ignore[override]
        return None


def raw_response(url: str, cookie: str = "") -> None:
    """Status, the headers that tell protection from content (server, cookies, location) and the start
    of the body, without following redirects: is this a login wall, a bot check or a region choice?"""
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "ru", "Accept": "text/html"}
    if cookie:
        headers["Cookie"] = cookie
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        r = opener.open(urllib.request.Request(url, headers=headers), timeout=30)
        status, hdrs, body = r.status, r.headers, r.read(400_000)
    except urllib.error.HTTPError as e:
        status, hdrs, body = e.code, e.headers, e.read(400_000)
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"raw {url}: {e}")
        return
    print(f"raw {url} cookie={cookie!r}: HTTP {status}")
    for name in (
        "Server",
        "Location",
        "WWW-Authenticate",
        "Content-Type",
        "X-Powered-By",
        "Via",
    ):
        if hdrs.get(name):
            print(f"  {name}: {hdrs.get(name)[:200]}")
    for c in hdrs.get_all("Set-Cookie") or []:
        print(f"  Set-Cookie: {c.split(';', 1)[0][:80]}")
    text = text_of(body)
    print(f"  body[{len(text)}]: {re.sub(r'\\s+', ' ', text[:500])}")
    for word in (
        "storeCode",
        "shopCode",
        "shop_code",
        "storeId",
        "x_shop",
        "captcha",
        "challenge",
        "servicepipe",
        "qrator",
        "ddos-guard",
    ):
        i = text.find(word)
        if i >= 0:
            print(f"  …{word}: {re.sub(r'\\s+', ' ', text[max(0, i - 80) : i + 120])}")


RAW = [
    ("https://magnit.ru/catalog/4834-moloko_syr_yaytsa", ""),
]

# Pages read with an ordinary cookie jar (the site sets a cookie and redirects to the same page).
SESSION = [
    "https://online.metro-cc.ru/category/ovoshchi-i-frukty/ovoshchi",
    "https://online.metro-cc.ru/products/lopatka",
]


def with_cookies(url: str) -> None:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept-Language": "ru",
            "Accept": "text/html",
        },
    )
    try:
        with opener.open(req, timeout=30) as r:
            status, body = r.status, r.read(5_000_000)
    except urllib.error.HTTPError as e:
        status, body = e.code, e.read(400_000)
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"session {url}: {e}")
        return
    html = text_of(body)
    print(f"session {url}: HTTP {status}, cookies {[c.name for c in jar]}")
    for line in describe_page(html):
        print(line)
    for word in (
        "shopCode",
        "storeCode",
        "storeId",
        "store_id",
        "regionId",
        "cityId",
        "x-shop",
        "x_shop",
    ):
        for m in list(re.finditer(re.escape(word), html))[:2]:
            print(
                f"  …{word}: {re.sub(r'\\s+', ' ', html[max(0, m.start() - 100) : m.start() + 140])}"
            )


def main(argv: list[str]) -> int:
    if argv == ["raw"]:
        for url, cookie in RAW:
            raw_response(url, cookie)
        for url in SESSION:
            with_cookies(url)
        return 0
    for name in argv or list(SITES):
        if name in SITES:
            try:
                probe(name, SITES[name])
            except (FetchError, ValueError, OSError, EOFError) as e:
                print(f"{name}: unexpected {type(e).__name__}: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
