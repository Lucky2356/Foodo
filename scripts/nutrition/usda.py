"""USDA FoodData Central, SR Legacy (April 2018) — public domain (CC0) nutrient data per 100 g.

    python -m scripts.nutrition.usda --list     # print every SR Legacy food: fdc_id | category | description

Runs in GitHub Actions: fdc.nal.usda.gov is not reachable from every development environment."""

from __future__ import annotations

import argparse
import csv
import io
import sys
import zipfile

from scripts.prices.common import Fetcher, FetchError

SR_LEGACY_ZIP = "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip"


def download() -> zipfile.ZipFile:
    data = Fetcher(SR_LEGACY_ZIP, delay=0, timeout=120, rules=[]).get(
        SR_LEGACY_ZIP, 100_000_000
    )
    return zipfile.ZipFile(io.BytesIO(data))


def table(z: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    path = next(n for n in z.namelist() if n.endswith("/" + name) or n == name)
    with z.open(path) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8")))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--list", action="store_true")
    # A job log holds about 5000 lines; the list of ~7800 foods is printed in two parts.
    parser.add_argument("--id-below", type=int, default=None)
    parser.add_argument("--id-from", type=int, default=None)
    args = parser.parse_args(argv)
    try:
        z = download()
    except FetchError as e:
        print(f"SR Legacy не скачан: {e}", file=sys.stderr)
        return 1
    print("files:", ", ".join(z.namelist()))
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
