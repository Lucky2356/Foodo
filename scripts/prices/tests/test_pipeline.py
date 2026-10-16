"""Price workflow logic without network: robots rules, offer parsing, Rosstat sheet, publishing."""

from __future__ import annotations

import json
from pathlib import Path

from scripts.prices import magnit, publish, rosstat
from scripts.prices.common import robots_allows, robots_rules

ROOT = Path(__file__).resolve().parents[3]
CITIES = json.loads((ROOT / "shared/data/geo/cities.json").read_text(encoding="utf-8"))[
    "cities"
]
PRODUCTS = {
    p["id"]: p
    for p in json.loads(
        (ROOT / "shared/data/products.json").read_text(encoding="utf-8")
    )["products"]
}

ROBOTS = """
User-agent: Yandex
Disallow: /

User-agent: *
Allow: *.js
Disallow: /*search
Disallow: *sortBy=
Disallow: /*?$
Allow: /catalog/*?page=
"""


def test_robots_rules_follow_the_star_group_and_longest_match() -> None:
    rules = robots_rules(ROBOTS)
    assert robots_allows(rules, "https://magnit.ru/catalog/4998-ryba")
    assert not robots_allows(rules, "https://magnit.ru/catalog?sortBy=price")
    assert not robots_allows(rules, "https://magnit.ru/search?q=x")
    assert not robots_allows(rules, "https://magnit.ru/catalog/1?")
    assert robots_allows(rules, "https://magnit.ru/catalog/1?page=2")
    assert not robots_allows(
        robots_rules(ROBOTS, "Yandex"), "https://magnit.ru/catalog/"
    )


def test_package_and_product_parsing() -> None:
    assert magnit.parse_package("Треска Borealis филе без кожи 300г") == (
        300,
        "g",
        False,
    )
    assert magnit.parse_package("Молоко Домик в деревне 3,2% 0,9 л") == (
        0.9,
        "l",
        False,
    )
    assert magnit.parse_package("Креветки Магнит Королевские цена за 1кг") == (
        1,
        "kg",
        True,
    )
    assert magnit.parse_package("Яйца куриные С1 10шт") == (10, "pcs", False)
    assert magnit.parse_package("Набор без веса") is None
    assert magnit.match_product("Картофель мытый 2кг") == "potato"
    assert magnit.match_product("Картофель фри замороженный 750г") is None
    assert magnit.match_product("Молоко Простоквашино 3,2% 930мл") == "milk"
    assert magnit.match_product("Молоко сгущенное 3,2% 380г") is None
    assert (
        magnit.match_product("Треска Borealis филе без кожи без кости 300г")
        == "cod_fillet"
    )
    assert magnit.match_product("Икра мойвы с копченым лососем 180г") is None


def test_median_offer_is_a_real_offer_with_base_unit_conversion() -> None:
    offers = [
        {"name": "Молоко А 3,2% 1л", "price": "100", "url": "a"},
        {"name": "Молоко Б 2,5% 0,9л", "price": "81", "url": "b"},
        {"name": "Молоко В 3,2% 930мл", "price": "120", "url": "c"},
        {"name": "Кефир 1% 900г", "price": "90", "url": "k"},
    ]
    chosen = magnit.choose(PRODUCTS, offers)
    assert (
        chosen["milk"]["url"] == "a" and chosen["milk"]["_count"] == 3
    )  # 0.100 ₽/мл is the median of 0.090, 0.100, 0.129
    # Kefir is measured in ml: 900 g ÷ 1.03 g/ml
    assert chosen["kefir"]["_package"] == (900, "g", False)
    assert (
        magnit.to_base(PRODUCTS["kefir"], 900, "g")
        == 900 / PRODUCTS["kefir"]["density_g_ml"]
    )


def test_rosstat_sheet_regions_cities_and_missing_values() -> None:
    rows = [
        ("К содержанию",),
        ("Код территории", "Наименование территории", "2501", "1501", "1111", "9999"),
        ("", "", "Картофель, кг", "Яйца куриные, 10 шт.", "Молоко, л", "Пиво, л"),
        ("643", "Российская Федерация", 50.0, 110.0, 90.0, 150.0),
        ("30", "Центральный федеральный округ", 51.0, 111.0, 91.0, 151.0),
        ("92000000000", "Республика Татарстан (Татарстан)", 45.5, 105.0, "...", 140.0),
        ("92401000000", "Казань", 47.0, "-", 95.0, 141.0),
        ("92499000000", "Город, которого нет в справочнике", 40.0, 100.0, 80.0, 1.0),
        (
            "45000000000",
            "Город Москва столица Российской Федерации город федерального значения",
            70.0,
            130.0,
            110.0,
            200.0,
        ),
        (
            "11100000000",
            "Ненецкий автономный округ (Архангельская область)",
            90.0,
            160.0,
            130.0,
            1.0,
        ),
    ]
    obs, summary = rosstat.parse_sheet(rows, CITIES, 2026, 9)
    by = {(o["product_id"], o["region"], o.get("city_id")): o for o in obs}
    kazan = next(c for c in CITIES if c["name"] == "Казань")
    tatarstan = kazan["region"]
    assert (
        by[("potato", tatarstan, None)]["price_kop"] == 4550
        and by[("potato", tatarstan, None)]["loose"] is True
    )
    assert by[("potato", tatarstan, kazan["id"])]["price_kop"] == 4700
    assert ("eggs", tatarstan, kazan["id"]) not in by  # «-» is no data, not zero
    assert ("milk", tatarstan, None) not in by  # «...» likewise
    assert (
        by[("eggs", tatarstan, None)]["package_size"] == 10
        and by[("eggs", tatarstan, None)]["package_unit"] == "pcs"
    )
    assert ("potato", "Москва", None) in by and (
        "potato",
        "Ненецкий автономный округ",
        None,
    ) in by
    assert all(o["observed_on"] == "2026-09-30" for o in obs)
    assert not any(o["region"] == "Российская Федерация" for o in obs)
    assert summary["unmatched_cities"] == [
        f"{tatarstan}: Город, которого нет в справочнике"
    ]


def test_latest_file_prefers_the_current_year_file() -> None:
    html = '<a href="/storage/mediabank/sred_potreb_cen_2025.xlsx"></a><a href="/storage/mediabank/sred_potreb_cen_09-2026.xlsx"></a><a href="/storage/mediabank/sred_potreb_cen_1991-2025.xlsx"></a>'
    assert (
        rosstat.latest_file_url(html)
        == "https://rosstat.gov.ru/storage/mediabank/sred_potreb_cen_09-2026.xlsx"
    )
    assert (
        rosstat.latest_month_sheet(["Содержание", "01(2026)", "09(2026)", "02(2026)"])[
            0
        ]
        == "09(2026)"
    )


def test_every_mapped_product_exists() -> None:
    for products, _, _ in rosstat.GOODS.values():
        assert set(products) <= set(PRODUCTS)
    assert set(magnit.RULES) <= set(PRODUCTS)


def test_publish_groups_by_region_city_and_chain(tmp_path: Path) -> None:
    base = {
        "price_kop": 100,
        "package_size": 1,
        "package_unit": "kg",
        "observed_on": "2026-09-30",
        "loose": True,
    }
    (tmp_path / "rosstat.json").write_text(
        json.dumps(
            {
                "kind": "rosstat",
                "observations": [
                    {**base, "product_id": "potato", "region": "R"},
                    {**base, "product_id": "potato", "region": "R", "city_id": "C1"},
                ],
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "scraped-magnit.json").write_text(
        json.dumps(
            {
                "kind": "scraped",
                "observations": [
                    {
                        **base,
                        "product_id": "potato",
                        "city_id": "C1",
                        "chain_id": "magnit",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    files = publish.build(tmp_path)
    index = files["index.json"]["files"]
    assert set(index) == {"region:R", "city:C1", "C1:magnit"}
    assert files[index["C1:magnit"]]["entries"][0]["kind"] == "scraped"
    assert files[index["region:R"]]["entries"][0]["date"] == "2026-09-30"


def test_store_location_from_the_page_state() -> None:
    # Fragment of magnit.ru/catalog/ as served on 16.10.2026 (store shown without an address).
    page = 'store:{id:"x",coordinates:{latitude:45.047057,longitude:38.973527},deliveryTypeList:["DELIVERY_TYPE_DELIVERY"],externalId:{owner:"OWNER_MAGNIT",storeCode:"992301"},isActive:true}'
    assert magnit.store_location(page) == ("992301", 45.047057, 38.973527)
    assert magnit.nearest_city(CITIES, 45.047057, 38.973527)["name"] == "Краснодар"
    assert magnit.store_location("<html>no store</html>") is None
