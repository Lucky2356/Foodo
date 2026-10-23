"""Magnit (magnit.ru): public catalogue prices of the store the site shows by default.

Category pages carry a schema.org OfferCatalog (name, price, product URL). The site shows one
store's prices without a selected address; the store's coordinates in the page decide which city
the prices belong to (the nearest Foodo city). Only the categories listed in the public sitemap and
allowed by robots.txt are read, one request every few seconds."""

from __future__ import annotations

import json
import math
import re
import statistics
from datetime import date
from typing import Any

from .common import Fetcher, FetchError

BASE = "https://magnit.ru"
CHAIN_ID = "magnit"

# Category slugs worth reading (food only); matched against the sitemap's catalogue URLs.
CATEGORY_WORDS = (
    "ovoshchi",
    "kartofel",
    "luk_i_chesnok",
    "pomidory",
    "zelen",
    "baklazhany",
    "pertsy",
    "kapusta",
    "griby",
    "yabloki",
    "tsitrus",
    "ekzotich",
    "yagody",
    "moloko",
    "maslo",
    "yaytsa",
    "mayonez",
    "smetana",
    "tvorog",
    "kefir",
    "yogurty",
    "tverdye",
    "myagkie",
    "rassolnye",
    "krupy",
    "grechka",
    "ris",
    "bobovye",
    "sakhar",
    "sol_i",
    "ketchup",
    "gorchitsa",
    "muka",
    "drozhzhi",
    "rastitelnye_masla",
    "goroshek",
    "fasol",
    "ogurchiki",
    "tomaty",
    "v_masle",
    "v_sobstvennom",
    "kuritsa",
    "indeyka",
    "farsh",
    "subprodukty",
    "govyadina",
    "svinina",
    "sosiki",
    "bekon",
    "zamorozka_ovoshchi",
    "zamorozka_yagody",
    "zamorozka_ryba",
    "krevetki",
    "moreprodukty",
    "okhlazhdennaya_ryba",
    "seld",
    "med",
    "varene",
    "sukhofrukty",
    "orekhi",
    "kakao",
    "makaron",
    "sousy",
    "uksus",
)
EXCLUDE_CATEGORY_WORDS = (
    "alkogol",
    "detsk",
    "dlya_detey",
    "zoo",
    "koshek",
    "sobak",
    "kosmet",
    "gigien",
    "sneki",
    "konfety",
)

# Foodo product → (must match, must not match). Regexes run on the lower-cased offer name.
RULES: dict[str, tuple[str, str]] = {
    "potato": (r"^картофель", r"фри|чипс|пюре|дольк|по-деревенск"),
    "carrot": (r"^морковь", r"корейск|сок|пюре|мини"),
    "onion": (r"^лук репчатый", r"жарен|сушен"),
    "garlic": (r"^чеснок", r"молот|сушен|соус|паст|маринов"),
    "beet": (r"^св[её]кла", r"варен|маринов|салат"),
    "cabbage": (r"^капуста белокочан", r"квашен|салат|маринов"),
    "tomato": (
        r"^(томаты|помидоры)",
        r"черри|консерв|вялен|сушен|паст|соус|собствен|маринов|слив",
    ),
    "cucumber": (r"^огурцы", r"маринов|солен|консерв|корнишон"),
    "bell_pepper": (r"^перец (сладкий|болгарск)", r"маринов|фарширов"),
    "zucchini": (r"^кабачк", r"икра|консерв|маринов"),
    "eggplant": (r"^баклажан", r"икра|консерв|маринов"),
    "champignons": (r"^шампиньон", r"маринов|консерв|жарен|суп"),
    "apple": (r"^яблок", r"сок|пюре|сушен|чипс|пирог"),
    "banana": (r"^бананы", r"чипс|сушен"),
    "orange": (r"^апельсин", r"сок|джем"),
    "lemon": (r"^лимон", r"сок|кислот|напит"),
    "pear": (r"^груш", r"сок|пюре"),
    "milk": (
        r"^молоко .*(2[,.]5|3[,.]2) ?%",
        r"сгущ|кокос|овсян|миндал|соев|детск|шоколад|коктейл|сух|безлакт",
    ),
    "kefir": (r"^кефир", r"детск|безлакт"),
    "ryazhenka": (r"^ряженка", r"детск"),
    "sour_cream": (r"^сметана", r"продукт|растит|соус"),
    "cottage_cheese": (r"^творог", r"масса|сыр[ок]|продукт|десерт|зерн|запеканк"),
    "butter": (r"^масло сливочное", r"шоколад|продукт|спред|топлен"),
    "eggs": (r"^яйц[ао] куриные", r"перепел|варен"),
    "cheese_hard": (
        r"^сыр .*(российск|голланд|гауда|тильзит|маасдам|пошехон|костромск|сметанков)",
        r"плавлен|творож|моцарел|колбас|пармез|нарезк.*\d{2,3} ?г",
    ),
    "mozzarella": (r"моцарелл", r"пицц|сыр-?косичк|снек"),
    "feta": (r"^(сыр )?(фета|брынза)", r"салат"),
    "yogurt_plain": (r"^йогурт .*(натурал|без добав|греческ)", r"питьев"),
    "cream_10": (r"^сливки .*\b10 ?%", r"раститель|взбит"),
    "cream_20": (r"^сливки .*\b2[02] ?%", r"раститель|взбит"),
    "mayonnaise": (r"^майонез", r"соус"),
    "sugar": (r"^сахар", r"тростник|пудр|ванил|заменит|кусков"),
    "salt": (r"^соль", r"морск|гималай|для ванн"),
    "wheat_flour": (r"^мука пшеничная", r"цельнозерн|блин"),
    "buckwheat_dry": (r"^(крупа )?гречн", r"хлоп|лапш|пакет|быстр|зелен"),
    "rice_white_dry": (r"^рис .*длиннозерн", r"пропарен|бур|дикий|пакет|жасмин|басмат"),
    "rice_round_dry": (r"^рис .*круглозерн", r"пакет"),
    "millet_dry": (r"^пшено", r"пакет"),
    "oats_flakes": (
        r"^(хлопья овсяные|овсяные хлопья|геркулес)",
        r"каша|пакетик|с добав",
    ),
    "pearl_barley_dry": (r"^(крупа )?перлов", r"пакет"),
    "semolina": (r"^(крупа )?манн", r"каша"),
    "bulgur_dry": (r"^булгур", r"пакет"),
    "couscous_dry": (r"^кус-?кус", r"пакет"),
    "red_lentils_dry": (r"^чечевица красн", r"пакет|суп"),
    "split_peas_dry": (r"^горох", r"консерв|зел[её]н|суп"),
    "pasta_dry": (r"^макарон", r"с сыром|быстр|ракушк.*сыр"),
    "spaghetti_dry": (r"^спагетти", r"с соус|болоньез|карбонар|готов"),
    "vermicelli_dry": (r"^вермишель", r"быстр|лапша"),
    "sunflower_oil": (r"^масло подсолнечное", r"нерафинир"),
    "olive_oil": (r"^масло оливковое", r"спрей"),
    "canned_tomatoes": (r"^томаты .*(собствен|резан|очищен)", r"черри|вялен"),
    "tomato_paste": (r"^(томатная паста|паста томатная)", r""),
    "ketchup": (r"^кетчуп", r""),
    "green_peas_canned": (r"^горошек зел[её]ный", r"заморож"),
    "corn_canned": (
        r"^кукуруза .*(сладк|консерв)",
        r"палочк|хлоп|попкорн|заморож|почат",
    ),
    "beans_canned": (
        r"^фасоль красная .*(консерв|собствен|натурал)",
        r"стручк|заморож",
    ),
    "pickled_cucumbers": (r"^огурц.*(маринов|солен|консерв)", r""),
    "tuna_canned": (r"^тунец", r"салат|паштет"),
    "chicken_breast": (
        r"(^филе (грудки )?(цыпл|кур))|(^грудк.*(цыпл|кур))",
        r"копч|варен|маринад|колбас|в панир",
    ),
    "chicken_thighs": (r"^бедр.*(цыпл|кур)", r"копч|маринад|филе бедр"),
    "chicken_drumsticks": (r"^голен.*(цыпл|кур)", r"копч|маринад"),
    "chicken_wings": (r"^крыл.*(цыпл|кур)", r"копч|маринад|остр"),
    "chicken_mince": (r"^фарш .*(кур|цыпл)", r""),
    "turkey_mince": (r"^фарш .*индей", r""),
    "beef_mince": (r"^фарш .*говяж", r"свин"),
    "mince_pork_beef": (r"^фарш .*(домашн|свино-говяж|говяже-свин)", r""),
    "pork": (r"^(свинина|лопатка) .*лопатк", r"копч|варен|тушен"),
    "pork_loin": (r"корейк.*свин|свин.*корейк", r"копч|варен"),
    "beef": (r"^говядина", r"тушен|консерв|копч|варен|фарш"),
    "chicken_liver": (r"^печень .*(кур|цыпл)", r"паштет"),
    "frankfurters": (r"^сосиски", r"в тесте|кур"),
    "bacon": (r"^бекон", r"чипс"),
    "herring_salted": (r"^(сельдь|филе сельди)", r"под шуб|в масле|в соус|копч"),
    "cod_fillet": (r"^(треска|филе трески)", r"копч|солен|печень|котлет"),
    "pollock_fillet": (r"^(минтай|филе минтая)", r"копч|солен|котлет|палочк"),
    "hake_fillet": (r"^(хек|филе хека)", r"копч|котлет"),
    "pink_salmon": (
        r"^(горбуша|филе горбуши)",
        r"икра|консерв|копч|солен|вялен|соломк",
    ),
    "salmon_fillet": (
        r"^(лосось|сёмга|семга|филе (лосося|сёмги|семги)|стейк (лосося|сёмги))",
        r"копч|солен|слабосол|икра|масло|паштет",
    ),
    "mackerel": (r"^скумбри", r"копч|консерв|солен|пресерв"),
    "shrimp": (r"^креветки", r"чипс|панир|салат|соус|маринад"),
    "squid": (r"^кальмар", r"сушен|копч|солен|вялен|снек|салат|консерв"),
    "crab_sticks": (r"^крабовые палочки", r""),
    "honey": (r"^м[её]д ", r"пряник|напит"),
    "jam": (r"^(варенье|джем|конфитюр)", r""),
    "walnuts": (r"грецк", r"шоколад|конфет"),
    "raisins": (r"^изюм", r"шоколад"),
    "prunes": (r"^чернослив", r"шоколад"),
    "dried_apricots": (r"^курага", r"шоколад"),
    "frozen_veg_mix": (r"^(смесь овощная|овощная смесь)", r""),
    "green_beans_frozen": (r"^фасоль стручков", r"консерв"),
    "green_peas_frozen": (r"^горошек .*заморож", r""),
    "blueberries_frozen": (r"^черник.*заморож", r""),
    "strawberries_frozen": (r"^клубник.*заморож", r""),
    "cranberries_frozen": (r"^клюкв.*заморож", r""),
    "dill": (r"^укроп", r"сушен"),
    "parsley": (r"^петрушк", r"сушен|корен"),
    "green_onion": (r"^лук зел", r""),
    "spinach": (r"^шпинат", r""),
    "cocoa_powder": (r"^какао", r"напит|быстр|растворим"),
    "dry_yeast": (r"^дрожжи .*сух", r""),
    "baking_powder": (r"^разрыхлитель", r""),
    "soy_sauce": (r"^соус соевый", r""),
    "vinegar": (r"^уксус столовый", r"яблоч|винн|бальзам"),
    "mustard": (r"^горчица", r"порош|зерн"),
}

SIZE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(кг|г|гр|л|мл|шт)\b")
PER_KG = re.compile(r"цена за 1 ?кг|весов|на развес", re.IGNORECASE)


def parse_package(name: str) -> tuple[float, str, bool] | None:
    """(size, unit, loose) from an offer name: «…300г», «…0,9 л», «…10шт», «цена за 1кг»."""
    lowered = name.lower()
    if PER_KG.search(lowered):
        return 1.0, "kg", True
    matches = SIZE.findall(lowered)
    if not matches:
        return None
    value, unit = matches[-1]
    size = float(value.replace(",", "."))
    if size <= 0:
        return None
    unit = {"гр": "g", "г": "g", "кг": "kg", "л": "l", "мл": "ml", "шт": "pcs"}[unit]
    return size, unit, False


def to_base(product: dict[str, Any], size: float, unit: str) -> float | None:
    """Package size in the product's base unit; None when the conversion needs data we don't have."""
    grams = {"g": size, "kg": size * 1000}.get(unit)
    ml = {"ml": size, "l": size * 1000}.get(unit)
    base = product["base_unit"]
    density = product.get("density_g_ml")
    piece = product.get("piece_g")
    if base == "g":
        if grams is not None:
            return grams
        if ml is not None and density:
            return ml * density
        if unit == "pcs" and piece:
            return size * piece
        return None
    if base == "ml":
        if ml is not None:
            return ml
        if grams is not None and density:
            return grams / density
        return None
    if unit == "pcs":
        return size
    if grams is not None and piece:
        return grams / piece
    return None


def match_product(name: str) -> str | None:
    lowered = name.lower()
    for product, (must, must_not) in RULES.items():
        if re.search(must, lowered) and not (must_not and re.search(must_not, lowered)):
            return product
    return None


def offers_from_html(html: str) -> list[dict[str, Any]]:
    out = []
    for block in re.findall(
        r"<script[^>]+application/ld\+json[^>]*>(.*?)</script>", html, re.DOTALL
    ):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        if isinstance(data, dict) and data.get("@type") == "OfferCatalog":
            for item in data.get("itemListElement", []):
                if isinstance(item, dict) and item.get("name") and item.get("price"):
                    out.append(item)
    return out


def store_location(html: str) -> tuple[str, float, float] | None:
    """The default store's code and coordinates from the page state (Nuxt payload): the store
    object lists latitude/longitude shortly before its externalId with the storeCode."""
    m = re.search(r'storeCode:"(\d+)"', html)
    if not m:
        return None
    window = html[max(0, m.start() - 2000) : m.start()]
    lats = re.findall(r"latitude:(-?\d+(?:\.\d+)?)", window)
    lons = re.findall(r"longitude:(-?\d+(?:\.\d+)?)", window)
    if not lats or not lons:
        return None
    return m.group(1), float(lats[-1]), float(lons[-1])


def nearest_city(
    cities: list[dict[str, Any]], lat: float, lon: float
) -> dict[str, Any]:
    def dist(c: dict[str, Any]) -> float:
        dlat, dlon = math.radians(c["lat"] - lat), math.radians(c["lon"] - lon)
        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat))
            * math.cos(math.radians(c["lat"]))
            * math.sin(dlon / 2) ** 2
        )
        return 2 * 6371 * math.asin(math.sqrt(a))

    return min(cities, key=dist)


def choose(
    products: dict[str, dict[str, Any]], offers: list[dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    """Per product, the real offer whose price per base unit is the median of all matched offers."""
    candidates: dict[str, list[tuple[float, dict[str, Any]]]] = {}
    for offer in offers:
        product_id = match_product(offer["name"])
        package = parse_package(offer["name"])
        if product_id is None or package is None or product_id not in products:
            continue
        size, unit, loose = package
        base = to_base(products[product_id], size, unit)
        try:
            price = float(offer["price"])
        except (TypeError, ValueError):
            continue
        if not base or price <= 0:
            continue
        candidates.setdefault(product_id, []).append(
            (price / base, {**offer, "_package": (size, unit, loose), "_price": price})
        )
    chosen = {}
    for product_id, items in candidates.items():
        items.sort(key=lambda x: x[0])
        median = statistics.median_low([x[0] for x in items])
        chosen[product_id] = next(o for unit_price, o in items if unit_price == median)
        chosen[product_id]["_count"] = len(items)
    return chosen


def collect(
    products: dict[str, dict[str, Any]],
    cities: list[dict[str, Any]],
    max_categories: int = 80,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    fetcher = Fetcher(BASE, delay=3.0)
    catalog_html = fetcher.text(f"{BASE}/catalog/")
    location = store_location(catalog_html)
    if location is None:
        raise FetchError("Не удалось определить магазин, цены которого показывает сайт")
    store, lat, lon = location
    city = nearest_city(cities, lat, lon)
    sitemap = fetcher.text(f"{BASE}/__sitemap__/catalog.xml")
    urls = [
        u
        for u in re.findall(r"<loc>([^<]+)</loc>", sitemap)
        if re.search(r"/catalog/\d+-", u)
    ]
    wanted = [
        u
        for u in urls
        if any(w in u for w in CATEGORY_WORDS)
        and not any(w in u for w in EXCLUDE_CATEGORY_WORDS)
    ][:max_categories]
    offers: list[dict[str, Any]] = []
    failed = 0
    for url in wanted:
        try:
            offers += offers_from_html(fetcher.text(url))
        except FetchError:
            failed += 1
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
                "source": f"magnit.ru, магазин {store}: {offer['name']}"[:200],
                "source_url": offer.get("url", "")[:500],
                "external_id": offer.get("url", "")[:200],
            }
        )
    summary = {
        "store": store,
        "city_id": city["id"],
        "city": city["name"],
        "categories": len(wanted),
        "categories_failed": failed,
        "offers": len(offers),
        "products": len(observations),
        "requests": fetcher.requests,
    }
    return observations, summary
