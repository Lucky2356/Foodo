"""Livsmedelsverket (Swedish Food Agency) food composition database — open data, CC BY 4.0.

    python -m scripts.nutrition.livsmedel --discover  # API description and one food with its nutrients
    python -m scripts.nutrition.livsmedel --list      # every food: number | Swedish name | English name
    python -m scripts.nutrition.livsmedel --apply     # values for livsmedel_map.json → livsmedel_values.json
    python -m scripts.nutrition.livsmedel --check     # the committed livsmedel_values.json matches the API

The database is updated by the agency; --check then reports the difference and --apply refreshes it.

Runs in GitHub Actions: the API is not reachable from every development environment.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from scripts.prices.common import Fetcher, FetchError

API = "https://dataportal.livsmedelsverket.se/livsmedel"
SWAGGER = API + "/swagger/v1/swagger.json"
HERE = Path(__file__).resolve().parent
MAP = HERE / "livsmedel_map.json"
VALUES = Path(__file__).resolve().parents[1] / "catalog/sources/livsmedel_values.json"


# Units the conversion below expects (Livsmedelsdatabasen, per 100 g edible portion).
UNITS = {
    "ENERC": "kcal",
    "PROT": "g",
    "FAT": "g",
    "WATER": "g",
    "ASH": "g",
    "ALC": "g",
    "FIBT": "g",
    "RETOL": "µg",
    "CARTBTOT": "µg",
    "VITC": "mg",
    "VITE": "mg",
    "VITB6": "mg",
    "VITB12": "µg",
    "FOL": "µg",
}


def catalog_nutrients(
    nutrients: dict[str, dict[str, object]], fortified: bool
) -> dict[str, float | None]:
    """Foodo nutrients from published Livsmedelsdatabasen values, in Foodo's forms.

    Definitions are the agency's (Omräkningsfaktorer som används i Livsmedelsdatabasen):
    - carbohydrates there are «available»; Foodo's are by difference, computed by that definition:
      100 − water − protein − fat − ash − alcohol;
    - vitamin E is alpha-tocopherol, as in Foodo;
    - vitamin D includes 25-hydroxy-D3 × 2.5 where measured — not Foodo's D2 + D3, so not taken;
    - vitamin A is RAE from retinol and beta-carotene only. Retinol equivalents of МР 2.3.1.0253-21
      also count the other provitamin A carotenoids, which the API does not give, so vitamin A is
      taken only where the database marks beta-carotene a logical zero (no carotenoids in the food):
      there RE equals retinol. Fortified foods (vitamins A and D added in Sweden) get neither.
    """

    def value(code: str) -> float | None:
        row = nutrients.get(code)
        if row is None or row.get("value") is None:
            return None
        if row.get("unit") != UNITS[code]:
            raise ValueError(
                f"{code}: единица {row.get('unit')}, ожидалась {UNITS[code]}"
            )
        return float(str(row["value"]))

    parts = [value(c) for c in ("WATER", "PROT", "FAT", "ASH", "ALC")]
    carbs = None
    if all(p is not None for p in parts):
        carbs = round(max(100 - sum(p for p in parts if p is not None), 0.0), 1)
    vit_a = None
    beta = nutrients.get("CARTBTOT")
    if not fortified and beta is not None and beta.get("type") == "LZ":
        vit_a = value("RETOL")
    return {
        "kcal": value("ENERC"),
        "protein": value("PROT"),
        "fat": value("FAT"),
        "carbs": carbs,
        "fiber": value("FIBT"),
        "vit_a": vit_a,
        "vit_c": value("VITC"),
        "vit_d": None,
        "vit_e": value("VITE"),
        "vit_b6": value("VITB6"),
        "vit_b12": value("VITB12"),
        "folate": value("FOL"),
    }


def fetcher() -> Fetcher:
    # rules=None: the site's robots.txt is read and respected; one request a second.
    return Fetcher(API, delay=1, timeout=120, rules=None)


def get(f: Fetcher, path: str) -> Any:
    return json.loads(f.text(API + path))


def foods(f: Fetcher, language: int) -> list[dict[str, Any]]:
    """All foods, page by page (sprak: 1 Swedish, 2 English)."""
    out: list[dict[str, Any]] = []
    while True:
        page = get(f, f"/api/v1/livsmedel?offset={len(out)}&limit=500&sprak={language}")
        items = page["livsmedel"] if isinstance(page, dict) else page
        out += items
        if len(items) < 500:
            return out


def discover(f: Fetcher) -> None:
    swagger = get(f, "/swagger/v1/swagger.json")
    print("api:", json.dumps(swagger.get("info"), ensure_ascii=False))
    for path, ops in swagger.get("paths", {}).items():
        print("path:", path, list(ops))
    first = get(f, "/api/v1/livsmedel?offset=0&limit=2&sprak=2")
    print("list page:", json.dumps(first, ensure_ascii=False)[:1500])
    items = first["livsmedel"] if isinstance(first, dict) else first
    number = items[0]["nummer"]
    for suffix in ("naringsvarden", "klassificeringar", "ingredienser"):
        try:
            data = get(f, f"/api/v1/livsmedel/{number}/{suffix}?sprak=2")
        except FetchError as e:
            print(suffix, e)
            continue
        print(f"{suffix}:", json.dumps(data, ensure_ascii=False)[:6000])


def values_for(f: Fetcher, mapping: dict[str, dict[str, object]]) -> dict[str, object]:
    """Every published nutrient of the mapped foods, as given: value, unit, value type."""
    names = {x["nummer"]: x["namn"] for x in foods(f, 1)}
    names_en = {x["nummer"]: x["namn"] for x in foods(f, 2)}
    products = {}
    for pid, m in sorted(mapping.items()):
        number = int(str(m["nummer"]))
        if number not in names:
            raise ValueError(f"{pid}: livsmedel {number} нет в базе")
        rows = get(f, f"/api/v1/livsmedel/{number}/naringsvarden?sprak=2")
        nutrients = {}
        for r in rows:
            if r.get("matrisenhetkod") != "W":  # only «per 100 g edible portion»
                continue
            nutrients[r["euroFIRkod"]] = {
                "name": r["namn"],
                "value": r["varde"],
                "unit": r["enhet"],
                "type": r.get("vardetypkod"),
            }
        products[pid] = {
            "nummer": number,
            "name_sv": names[number],
            "name_en": names_en.get(number, ""),
            "nutrients": dict(sorted(nutrients.items())),
        }
    return {
        "format": "foodo-livsmedel-values",
        "version": 1,
        "dataset": "Livsmedelsverket, Livsmedelsdatabasen (Swedish Food Agency food composition database)",
        "url": API,
        "license": "CC BY 4.0",
        "products": products,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--discover", action="store_true")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    f = fetcher()
    try:
        if args.discover:
            discover(f)
        if args.list:
            sv = foods(f, 1)
            en = {x["nummer"]: x["namn"] for x in foods(f, 2)}
            for x in sv:
                print(f"{x['nummer']} | {x['namn']} | {en.get(x['nummer'], '')}")
        if args.apply or args.check:
            result = values_for(f, json.loads(MAP.read_text(encoding="utf-8")))
    except FetchError as e:
        print(f"Livsmedelsverket недоступен: {e}", file=sys.stderr)
        return 1
    if args.apply or args.check:
        text = json.dumps(result, ensure_ascii=False, indent=1) + "\n"
        if args.apply:
            VALUES.write_text(text, encoding="utf-8")
            # One line per product keeps the job log readable where the file cannot be fetched.
            header = {k: v for k, v in result.items() if k != "products"}
            print("@@header", json.dumps(header, ensure_ascii=False))
            products = result["products"]
            assert isinstance(products, dict)
            for pid, entry in products.items():
                print("@@product", pid, json.dumps(entry, ensure_ascii=False))
        elif not VALUES.exists() or VALUES.read_text(encoding="utf-8") != text:
            print(
                "livsmedel_values.json не совпадает с базой; выполните --apply",
                file=sys.stderr,
            )
            return 1
        else:
            print(
                f"livsmedel_values.json совпадает с базой: {len(json.loads(text)['products'])} продуктов"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
