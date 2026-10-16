"""Reachability probe for price sources, run from GitHub Actions runners (round 7: full lists)."""

from __future__ import annotations

import io
import json
import re
import ssl
import sys
import urllib.error
import urllib.request

UA = "FoodoPriceBot/0.1 (+https://github.com/Lucky2356/Foodo; prices for a free meal planner)"


def fetch(url: str, ctx: ssl.SSLContext | None = None, binary: bool = False):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ru"})
    try:
        with urllib.request.urlopen(req, timeout=90, context=ctx) as r:
            data = r.read(40_000_000)
            return r.status, data if binary else data.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, b"" if binary else ""
    except Exception as e:  # noqa: BLE001
        return -1, f"{type(e).__name__}: {e}"


def main() -> int:
    import openpyxl

    ctx = ssl.create_default_context()
    for url in ["https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt", "http://nuc-cdp.digital.gov.ru/cdp/subca_ssl_rsa2024.crt"]:
        _, pem = fetch(url)
        ctx.load_verify_locations(cadata=pem)
    _, page = fetch("https://rosstat.gov.ru/statistics/price", ctx)
    links = sorted(set(re.findall(r'href="(/storage/mediabank/[^"]*potreb[^"]*\.xlsx)"', page, re.I)))
    print("CONSUMER PRICE LINKS:", links)
    yearly = sorted((int(m.group(1)), l) for l in links if (m := re.search(r"sred_potreb_cen_(\d{4})", l)))
    url = "https://rosstat.gov.ru" + yearly[-1][1]
    status, data = fetch(url, ctx, binary=True)
    print("latest file:", url, status, len(data))
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    sheets = [ws.title for ws in wb.worksheets]
    print("SHEETS:", sheets)
    month = [s for s in sheets if re.fullmatch(r"\d\d\(\d{4}\)", s)][-1]
    ws = wb[month]
    rows = list(ws.iter_rows(values_only=True))
    codes, names = rows[3], rows[4]
    print(f"LATEST {month}: {len(rows)} rows")
    print("GOODS:")
    for i, (c, n) in enumerate(zip(codes, names)):
        if i >= 2 and n:
            print(f"  {i}|{c}|{n}")
    print("TERRITORIES:")
    for r in rows[5:]:
        if r and r[0]:
            print(f"  {r[0]}|{r[1]}")
    status, body = fetch("https://magnit.ru/__sitemap__/catalog.xml")
    locs = re.findall(r"<loc>([^<]+)</loc>", body)
    food = [l for l in locs if not re.search(r"alkogol|vino|pivo|zoo|gigien|bytov|kosmet|igrush|odezhd|posud|tekstil|elektro|bint|apteka|dom_", l)]
    print("\nMAGNIT CATEGORIES:", len(food))
    for l in food:
        print("  ", l)
    status, html = fetch("https://vkusvill.ru/goods/banany-731/")
    print("\nVV product:", status, len(html))
    for b in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.S)[:3]:
        print("  LD:", b.strip()[:1200])
    for m in list(re.finditer(r"(\d+(?:[.,]\d+)?)\s*(кг|г|шт|л)\b", html))[:15]:
        print("  unit ctx:", re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html[max(0, m.start() - 120): m.end() + 40])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
