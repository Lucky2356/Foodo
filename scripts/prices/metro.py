"""Metro Cash & Carry (online.metro-cc.ru): public product-page prices of stores in the largest
cities.

Every product page carries schema.org Product/Offer markup (name with the package size, price in
roubles) and the list of Metro stores in its page state. The collector picks one store per city the
way a visitor does on the site (the metroStoreId cookie), keeps the site's other cookies like any
HTTP client with a cookie jar, identifies itself honestly and reads only what robots.txt allows.
Product pages are picked from the public sitemap by name words, a limited number per product."""

from __future__ import annotations

import http.cookiejar
import json
import re
from datetime import date
from typing import Any

from . import magnit
from .common import Fetcher, FetchError
from .magnit import RULES, choose

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


def select_store(jar: http.cookiejar.CookieJar, store_id: int) -> None:
    """The store a visitor picks on the site: the cookie the site itself uses for the choice. Set
    before every request, since a response may reset it to «not chosen»."""
    jar.set_cookie(
        http.cookiejar.Cookie(
            0, "metroStoreId", str(store_id), None, False, "online.metro-cc.ru", False, False,
            "/", True, True, None, False, None, None, {},
        )
    )  # fmt: skip


def stores_by_city(
    stores: list[dict[str, Any]], cities: list[dict[str, Any]], limit: int
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """One store per Foodo city (the first listed), for the `limit` most populous cities; dark
    stores (delivery warehouses) are skipped. The city is the longest city name found in the
    store's address as a whole word."""
    by_name = sorted(cities, key=lambda c: -len(c["name"]))
    chosen: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    for store in stores:
        if not isinstance(store.get("store_id"), int) or re.search(
            r"дарк", str(store.get("name", "")), re.IGNORECASE
        ):
            continue
        address = str(store.get("address") or "")
        city = next(
            (
                c
                for c in by_name
                if re.search(
                    rf"(?<![А-Яа-яЁё-]){re.escape(c['name'])}(?![А-Яа-яЁё-])", address
                )
            ),
            None,
        )
        if city is not None and city["id"] not in chosen:
            chosen[city["id"]] = (city, store)
    ranked = sorted(chosen.values(), key=lambda cs: -(cs[0].get("population") or 0))
    return ranked[:limit]


def collect(
    products: dict[str, dict[str, Any]],
    cities: list[dict[str, Any]],
    per_product: int = 6,
    max_cities: int = 12,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    jar = http.cookiejar.CookieJar()
    fetcher = Fetcher(BASE, delay=1.5, cookies=jar)
    urls: list[str] = []
    for path in PRODUCT_SITEMAPS:
        urls += re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", fetcher.text(BASE + path))
    urls = [u for u in urls if "/products/" in u]
    if not urls:
        raise FetchError("В карте сайта нет страниц товаров")
    stores = trade_centers(fetcher.text(urls[0]))
    targets = stores_by_city(stores, cities, max_cities)
    if not targets:
        raise FetchError(
            f"Не удалось сопоставить магазины с городами ({len(stores)} магазинов на странице)"
        )
    candidates = {
        k: v for k, v in candidate_urls(urls, per_product).items() if k in products
    }

    def read(store_id: int, page_urls: list[str]) -> tuple[list[dict[str, Any]], int]:
        offers, failed = [], 0
        for url in page_urls:
            select_store(jar, store_id)
            try:
                offer = offer_from_html(fetcher.text(url), url)
            except FetchError:
                failed += 1
                continue
            if offer:
                offers.append(offer)
        return offers, failed

    today = date.today().isoformat()
    observations: list[dict[str, Any]] = []
    per_city: list[dict[str, Any]] = []
    known_urls: list[str] | None = None
    for city, store in targets:
        # The first city searches the sitemap candidates; the others re-read only the pages that
        # matched a Foodo product, so each extra city costs about one request per product.
        page_urls = (
            [u for v in candidates.values() for u in v]
            if known_urls is None
            else known_urls
        )
        offers, failed = read(store["store_id"], page_urls)
        chosen = choose(products, offers)
        if known_urls is None:
            known_urls = sorted(
                {
                    o["url"]
                    for o in offers
                    if magnit.match_product(o["name"]) in products
                }
            )
        for product_id, offer in sorted(chosen.items()):
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
                    "source": f"online.metro-cc.ru, {store['name']}: {offer['shown']}"[
                        :200
                    ],
                    "source_url": offer["url"][:500],
                    "external_id": f"{store['store_id']}:{offer['url']}"[:200],
                }
            )
        per_city.append(
            {
                "city": city["name"],
                "store": store["store_id"],
                "pages": len(page_urls),
                "failed": failed,
                "products": len(chosen),
            }
        )
    summary = {
        "stores_on_site": len(stores),
        "cities": per_city,
        "product_urls": len(urls),
        "products": len({o["product_id"] for o in observations}),
        "observations": len(observations),
        "requests": fetcher.requests,
    }
    return observations, summary


def _js_literals(text: str) -> list[Any]:
    """Top-level comma-separated JavaScript literals (strings, numbers, true/false/null, void 0,
    and anything else as raw text) — the argument list of a Nuxt payload function."""
    out: list[Any] = []
    i, n = 0, len(text)
    while i < n:
        while i < n and text[i] in " \n\t,":
            i += 1
        if i >= n:
            break
        if text[i] == '"':
            j = i + 1
            while j < n and text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            out.append(json.loads(text[i : j + 1]))
            i = j + 1
            continue
        depth, j = 0, i
        while j < n and not (depth == 0 and text[j] == ","):
            if text[j] in "{[(":
                depth += 1
            elif text[j] in "}])":
                depth -= 1
            elif text[j] == '"':
                j += 1
                while j < n and text[j] != '"':
                    j += 2 if text[j] == "\\" else 1
            j += 1
        raw = text[i:j].strip()
        if re.fullmatch(r"-?\d+(?:\.\d+)?(?:e-?\d+)?", raw):
            out.append(float(raw) if "." in raw or "e" in raw else int(raw))
        else:
            out.append(
                {"true": True, "false": False, "null": None, "void 0": None}.get(
                    raw, raw
                )
            )
        i = j
    return out


def trade_centers(html: str) -> list[dict[str, Any]]:
    """Metro stores from the page state: window.__NUXT__ is a function whose parameters stand for
    repeated values; the store list (tradecenter.list) refers to them by parameter name."""
    m = re.search(
        r"window\.__NUXT__=\(function\(([^)]*)\)\{(.*)\}\((.*)\)\);?\s*</script>",
        html,
        re.DOTALL,
    )
    if not m:
        return []
    names = [p.strip() for p in m.group(1).split(",")]
    values = dict(zip(names, _js_literals(m.group(3)), strict=False))
    body = m.group(2)

    def value(token: str) -> Any:
        token = token.strip()
        if token.startswith('"'):
            return json.loads(token)
        if re.fullmatch(r"-?\d+(?:\.\d+)?", token):
            return float(token) if "." in token else int(token)
        return values.get(token, token)

    out = []
    for entry in re.finditer(
        r"\{id:([\w$]+),store_id:([\w$]+),name:(\"(?:[^\"\\]|\\.)*\"|[\w$]+),address:(\"(?:[^\"\\]|\\.)*\"|[\w$]+)",
        body,
    ):
        out.append(
            {
                "id": value(entry.group(1)),
                "store_id": value(entry.group(2)),
                "name": value(entry.group(3)),
                "address": value(entry.group(4)),
            }
        )
    return out
