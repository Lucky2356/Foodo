"""USDA FoodData Central, SR Legacy (April 2018) — public domain (CC0) nutrient data per 100 g.

    python -m scripts.nutrition.usda --list     # print every SR Legacy food: fdc_id | category | description
    python -m scripts.nutrition.usda --apply    # values for the products in usda_map.json → usda_values.json
    python -m scripts.nutrition.usda --check    # the committed usda_values.json matches the dataset

Runs in GitHub Actions: fdc.nal.usda.gov is not reachable from every development environment."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

from scripts.prices.common import Fetcher, FetchError

SR_LEGACY_ZIP = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip"
HERE = Path(__file__).resolve().parent
MAP = HERE / "usda_map.json"
VALUES = Path(__file__).resolve().parents[1] / "catalog/sources/usda_values.json"

# SR nutrient numbers → Foodo nutrient ids, in the forms Foodo stores (shared/data/reference.json):
# energy in kcal as published (not recomputed 4/9/4), carbohydrates by difference, vitamin A as RAE,
# D as D2+D3, E as alpha-tocopherol, folate as food folate. Retinol and carotenoids are kept so
# retinol equivalents (RE, МР 2.3.1.0253-21, appendix 3) can be derived without guessing.
NUTRIENTS = {
    "208": "kcal",
    "203": "protein",
    "204": "fat",
    "205": "carbs",
    "291": "fiber",
    "320": "vit_a",
    "401": "vit_c",
    "328": "vit_d",
    "323": "vit_e",
    "415": "vit_b6",
    "418": "vit_b12",
    "432": "folate",
    "319": "retinol",
    "321": "beta_carotene",
    "322": "alpha_carotene",
    "334": "beta_cryptoxanthin",
}


def download() -> tuple[zipfile.ZipFile, str]:
    data = Fetcher(SR_LEGACY_ZIP, delay=0, timeout=120, rules=[]).get(
        SR_LEGACY_ZIP, 100_000_000
    )
    return zipfile.ZipFile(io.BytesIO(data)), hashlib.sha256(data).hexdigest()


def table(z: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    path = next(n for n in z.namelist() if n.endswith("/" + name) or n == name)
    with z.open(path) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8")))


def values_for(
    z: zipfile.ZipFile, sha256: str, mapping: dict[str, dict[str, object]]
) -> dict[str, object]:
    """Per-100 g values of the mapped foods. A nutrient the dataset does not report stays absent
    (unknown), never zero."""
    by_nbr = {
        row["nutrient_nbr"]: row["id"]
        for row in table(z, "nutrient.csv")
        if row["nutrient_nbr"] in NUTRIENTS
    }
    ids = {v: NUTRIENTS[k] for k, v in by_nbr.items()}
    foods = {row["fdc_id"]: row["description"] for row in table(z, "food.csv")}
    wanted = {str(m["fdc_id"]) for m in mapping.values()}
    amounts: dict[str, dict[str, float]] = {}
    for row in table(z, "food_nutrient.csv"):
        if (
            row["fdc_id"] in wanted
            and row["nutrient_id"] in ids
            and row["amount"] != ""
        ):
            amounts.setdefault(row["fdc_id"], {})[ids[row["nutrient_id"]]] = round(
                float(row["amount"]), 3
            )
    products = {}
    for pid, m in sorted(mapping.items()):
        fid = str(m["fdc_id"])
        if fid not in foods:
            raise ValueError(f"{pid}: FDC ID {fid} нет в SR Legacy")
        products[pid] = {
            "fdc_id": int(fid),
            "description": foods[fid],
            "per_100g": dict(sorted(amounts.get(fid, {}).items())),
        }
    return {
        "format": "foodo-usda-values",
        "version": 1,
        "dataset": "USDA FoodData Central, SR Legacy (April 2018)",
        "url": SR_LEGACY_ZIP,
        "sha256": sha256,
        "license": "public domain (CC0 1.0)",
        "products": products,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--list", action="store_true")
    # A job log holds about 5000 lines; the list of ~7800 foods is printed in two parts.
    parser.add_argument("--id-below", type=int, default=None)
    parser.add_argument("--id-from", type=int, default=None)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    try:
        z, sha256 = download()
    except FetchError as e:
        print(f"SR Legacy не скачан: {e}", file=sys.stderr)
        return 1
    print("files:", ", ".join(z.namelist()), "\nsha256:", sha256)
    if args.apply or args.check:
        result = values_for(z, sha256, json.loads(MAP.read_text(encoding="utf-8")))
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
                "usda_values.json не совпадает с набором данных; выполните --apply",
                file=sys.stderr,
            )
            print(text)
            return 1
        else:
            print(
                f"usda_values.json совпадает с набором данных: {len(json.loads(text)['products'])} продуктов"
            )
    if args.list:
        categories = {c["id"]: c["description"] for c in table(z, "food_category.csv")}
        for food in table(z, "food.csv"):
            fid = int(food["fdc_id"])
            if (args.id_below and fid >= args.id_below) or (
                args.id_from and fid < args.id_from
            ):
                continue
            print(
                f"{food['fdc_id']} | {categories.get(food['food_category_id'], '?')} | {food['description']}"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
