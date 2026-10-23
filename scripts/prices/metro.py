"""Metro Cash & Carry (online.metro-cc.ru): public product-page prices of the store the site shows by
default.

Every product page carries schema.org Product/Offer markup (name with the package size, price in
roubles). The site sets ordinary cookies on the first visit (including the default store and its
coordinates) and redirects to the same page; the collector keeps them like any HTTP client with a
cookie jar, identifies itself honestly and reads only what robots.txt allows. Product pages are
picked from the public sitemap by name words, a limited number per Foodo product."""

from __future__ import annotations

import http.cookiejar
import json
import re
import urllib.parse
from datetime import date
from typing import Any

from .common import Fetcher, FetchError
from .magnit import RULES, choose, nearest_city

BASE = "https://online.metro-cc.ru"
CHAIN_ID = "metro"
PRODUCT_SITEMAPS = ("/sitemap-2.xml", "/sitemap-3.xml")

TRANSLIT = str.maketrans(
    {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z",
        "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r",
        "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch",
        "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    }
)  # fmt: skip

# «Мука …, 2кг x 6 шт»: a case of several packages; the price is for the whole case.
MULTIPACK = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(кг|г|гр|л|мл)\s*[xх×]\s*(\d+)\s*шт", re.IGNORECASE
)


def slug_stems(must: str) -> list[str]:
    """Stems (the first 5 Russian letters, transliterated) of the words in a matching rule, as in
    Metro's product URLs («^картофель» → «karto»)."""
    words = re.findall(r"[а-яё]{4,}", must.lower())
    return sorted({w[:5].translate(TRANSLIT) for w in words})


def candidate_urls(urls: list[str], per_product: int) -> dict[str, list[str]]:
    """Product URLs whose slug starts (after an optional size prefix) with a stem of the product."""
    tokens = []
    for url in urls:
        slug = url.rstrip("/").rsplit("/", 1)[-1]
        # «450g-makarony-…» → «makarony-…»: Metro puts the size first for some products.
        tokens.append((url, re.sub(r"^\d+(?:-\d+)?(?:g|kg|ml|l|sht)-", "", slug)))
    out: dict[str, list[str]] = {}
    for product_id, (must, _) in RULES.items():
        stems = slug_stems(must)
        if not stems:
            continue
        hits = [u for u, slug in tokens if any(slug.startswith(s) for s in stems)]
        if hits:
            out[product_id] = hits[:per_product]
    return out


def offer_from_html(html: str, url: str) -> dict[str, Any] | None:
    """The Product/Offer of a product page as {name, price, url}; a case of N packages is reported
    as one package of N × size so that the price per kilogram stays right."""
    for block in re.findall(
        r"<script[^>]+application/ld\+json[^>]*>(.*?)</script>", html, re.DOTALL
    ):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        if not isinstance(data, dict) or data.get("@type") != "Product":
            continue
        offer = data.get("offers")
        if not isinstance(offer, dict) or offer.get("priceCurrency") != "RUB":
            continue
        if offer.get("availability") and "InStock" not in str(offer["availability"]):
            return None
        name = str(data.get("name") or "")
        price = offer.get("price")
        if not name or not isinstance(price, (int, float)) or price <= 0:
            return None
        # «Мука Makfa пшеничная…»: the brand sits after the first word; without it the name reads
        # like the ones the matching rules expect («Мука пшеничная…»).
        shown = name
        brand = (
            str((data.get("brand") or {}).get("name") or "")
            if isinstance(data.get("brand"), dict)
            else ""
        )
        if brand and brand.lower() != "без бренда":
            name = re.sub(
                r"\s+", " ", re.sub(re.escape(brand), " ", name, flags=re.IGNORECASE)
            ).strip()
        case = MULTIPACK.search(name)
        if case:
            size = float(case.group(1).replace(",", ".")) * int(case.group(3))
            name = MULTIPACK.sub(f"{size:g}{case.group(2)}", name)
        return {"name": name, "shown": shown, "price": price, "url": url}
    return None


def store_coordinates(jar: http.cookiejar.CookieJar) -> tuple[str, float, float] | None:
    """The default store (cookie metroStoreId) and its coordinates (cookie coords, «lat,lon» or a
    JSON object) set by the site on the first visit."""
    store = next((c.value for c in jar if c.name == "metroStoreId"), None)
    coords = next(
        (urllib.parse.unquote(c.value or "") for c in jar if c.name == "coords"), None
    )
    if not store or not coords:
        return None
    numbers = re.findall(r"-?\d+(?:\.\d+)?", coords)
    if len(numbers) < 2:
        return None
    lat, lon = float(numbers[0]), float(numbers[1])
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return store, lat, lon


def collect(
    products: dict[str, dict[str, Any]],
    cities: list[dict[str, Any]],
    per_product: int = 6,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    fetcher = Fetcher(BASE, delay=1.5, cookies=http.cookiejar.CookieJar())
    urls: list[str] = []
    for path in PRODUCT_SITEMAPS:
        urls += re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", fetcher.text(BASE + path))
    urls = [u for u in urls if "/products/" in u]
    location = (
        store_coordinates(fetcher.cookies) if fetcher.cookies is not None else None
    )
    if location is None:
        raise FetchError("Сайт не сообщил магазин по умолчанию и его координаты")
    store, lat, lon = location
    city = nearest_city(cities, lat, lon)
    candidates = candidate_urls(urls, per_product)
    offers: list[dict[str, Any]] = []
    failed = 0
    for product_id in sorted(candidates):
        if product_id not in products:
            continue
        for url in candidates[product_id]:
            try:
                offer = offer_from_html(fetcher.text(url), url)
            except FetchError:
                failed += 1
                continue
            if offer:
                offers.append(offer)
    today = date.today().isoformat()
    observations = []
    for product_id, offer in sorted(choose(products, offers).items()):
        size, unit, loose = offer["_package"]
        observations.append(
            {
                "product_id": product_id,
                "chain_id": CHAIN_ID,
                "city_id": city["id"],
                "price_kop": round(offer["_price"] * 100),
                "package_size": size,
                "package_unit": unit,
                "loose": loose,
                "observed_on": today,
                "source": f"online.metro-cc.ru, магазин {store}: {offer['shown']}"[
                    :200
                ],
                "source_url": offer["url"][:500],
                "external_id": offer["url"][:200],
            }
        )
    summary = {
        "store": store,
        "store_coords": [lat, lon],
        "city_id": city["id"],
        "city": city["name"],
        "product_urls": len(urls),
        "pages": sum(len(v) for k, v in candidates.items() if k in products),
        "pages_failed": failed,
        "offers": len(offers),
        "products": len(observations),
        "requests": fetcher.requests,
    }
    return observations, summary
