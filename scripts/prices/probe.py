"""Reachability probe for price sources, run from GitHub Actions runners.

Prints one line per URL: HTTP status, content type, size and a short excerpt. Used to decide which
sources can be collected from GitHub's network at all (many Russian sites block foreign IPs)."""

from __future__ import annotations

import sys
import urllib.error
import urllib.request

UA = "FoodoPriceBot/0.1 (+https://github.com/Lucky2356/Foodo; prices for a free meal planner)"

URLS = [
    "https://rosstat.gov.ru/statistics/price",
    "https://rosstat.gov.ru/robots.txt",
    "https://www.fedstat.ru/indicator/31448",
    "https://fedstat.ru/robots.txt",
    "https://showdata.gks.ru/report/278930/",
    "https://www.gks.ru/",
    "https://magnit.ru/robots.txt",
    "https://5ka.ru/robots.txt",
    "https://www.perekrestok.ru/robots.txt",
    "https://lenta.com/robots.txt",
    "https://vkusvill.ru/robots.txt",
    "https://www.auchan.ru/robots.txt",
    "https://online.metro-cc.ru/robots.txt",
    "https://www.okeydostavka.ru/robots.txt",
    "https://online.globus.ru/robots.txt",
    "https://dixy.ru/robots.txt",
    "https://www.maria-ra.ru/robots.txt",
    "https://monetka.ru/robots.txt",
    "https://myspar.ru/robots.txt",
    "https://kuper.ru/robots.txt",
    "https://samokat.ru/robots.txt",
    "https://www.vprok.ru/robots.txt",
]


def probe(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ru"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read(200_000)
            excerpt = body[:160].decode("utf-8", "replace").replace("\n", " ")
            return f"{r.status} {r.headers.get('Content-Type', '')} {len(body)}B | {excerpt}"
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code} {e.headers.get('Server', '')}"
    except Exception as e:  # noqa: BLE001 — a probe reports every failure kind
        return f"ERR {type(e).__name__}: {e}"


def main() -> int:
    for url in URLS:
        print(f"{url} -> {probe(url)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
