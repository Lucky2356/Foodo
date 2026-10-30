"""Fineli, the Finnish food composition database (THL), open data package — CC BY 4.0.

    python -m scripts.nutrition.fineli --discover  # download links on the open data page, component definitions
    python -m scripts.nutrition.fineli --list      # every food: FOODID | type | process | Finnish name | English name
    python -m scripts.nutrition.fineli --apply     # values for the products in fineli_map.json → fineli_values.json
    python -m scripts.nutrition.fineli --check     # the committed fineli_values.json matches the package

Runs in GitHub Actions: fineli.fi is not reachable from every development environment.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sys
import zipfile
from pathlib import Path

from scripts.prices.common import Fetcher, FetchError

OPEN_DATA_PAGE = "https://fineli.fi/fineli/en/avoin-data"
COMPONENTS_API = "https://fineli.fi/fineli/api/v1/components"
# Basic package 2 (all 74 components), linked from OPEN_DATA_PAGE; set once --discover has shown it.
PACKAGE = ""
HERE = Path(__file__).resolve().parent
MAP = HERE / "fineli_map.json"
VALUES = Path(__file__).resolve().parents[1] / "catalog/sources/fineli_values.json"

# Fineli component codes (EuroFIR names) → keys of fineli_values.json, as published. Energy is only in
# kJ; carbohydrate by difference includes fibre like Foodo's; vitamin A is RAE (the catalog derives RE
# from it and retinol); folate is total folate.
COMPONENTS = {
    "ENERC": "energy_kj",
    "PROT": "protein",
    "FAT": "fat",
    "CHOCDF": "carbs",
    "FIBC": "fiber",
    "VITA": "vit_a",
    "RETOL": "retinol",
    "CARTB": "beta_carotene",
    "VITC": "vit_c",
    "VITD": "vit_d",
    "VITE": "vit_e",
    "VITPYRID": "vit_b6",
    "VITB12": "vit_b12",
    "FOL": "folate",
}


def fetcher(url: str) -> Fetcher:
    # rules=None: the site's robots.txt is read and respected.
    return Fetcher(url, delay=1, timeout=120, rules=None)


def download(url: str) -> tuple[zipfile.ZipFile, str]:
    data = fetcher(url).get(url, 50_000_000)
    return zipfile.ZipFile(io.BytesIO(data)), hashlib.sha256(data).hexdigest()


def table(z: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    """A package CSV: «;»-separated, Latin-1 (the package's descript.txt)."""
    path = next(n for n in z.namelist() if n.split("/")[-1].lower() == name.lower())
    with z.open(path) as f:
        text = io.TextIOWrapper(f, encoding="latin-1", newline="")
        return list(csv.DictReader(text, delimiter=";"))


def number(text: str) -> float | None:
    """A component value; an empty field is missing data, not zero."""
    text = text.strip().replace(",", ".")
    return float(text) if text else None


def values_for(
    z: zipfile.ZipFile, sha256: str, url: str, mapping: dict[str, dict[str, object]]
) -> dict[str, object]:
    names = {r["FOODID"]: r["FOODNAME"] for r in table(z, "foodname_EN.csv")}
    names_fi = {r["FOODID"]: r["FOODNAME"] for r in table(z, "foodname_FI.csv")}
    wanted = {str(m["fineli_id"]) for m in mapping.values()}
    amounts: dict[str, dict[str, float]] = {}
    for row in table(z, "component_value.csv"):
        key = COMPONENTS.get(row["EUFDNAME"])
        if row["FOODID"] in wanted and key:
            value = number(row["BESTLOC"])
            if value is not None:
                amounts.setdefault(row["FOODID"], {})[key] = round(value, 3)
    products = {}
    for pid, m in sorted(mapping.items()):
        fid = str(m["fineli_id"])
        if fid not in names:
            raise ValueError(f"{pid}: FOODID {fid} нет в пакете Fineli")
        products[pid] = {
            "fineli_id": int(fid),
            "name_fi": names_fi.get(fid, ""),
            "name_en": names[fid],
            "per_100g": dict(sorted(amounts.get(fid, {}).items())),
        }
    return {
        "format": "foodo-fineli-values",
        "version": 1,
        "dataset": "Fineli, Finnish Food Composition Database, THL — open data basic package 2",
        "url": url,
        "sha256": sha256,
        "license": "CC BY 4.0",
        "products": products,
    }


def discover() -> None:
    page = fetcher(OPEN_DATA_PAGE).text(OPEN_DATA_PAGE)
    for href, label in re.findall(
        r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', page, re.DOTALL
    ):
        if "file" in href or "zip" in href.lower():
            print("link:", href, "|", re.sub(r"<[^>]+>|\s+", " ", label).strip())
    for c in json.loads(fetcher(COMPONENTS_API).text(COMPONENTS_API)):
        print("component:", json.dumps(c, ensure_ascii=False))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--discover", action="store_true")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.discover:
            discover()
        if not (args.list or args.apply or args.check):
            return 0
        if not PACKAGE:
            print("PACKAGE не задан: сначала --discover", file=sys.stderr)
            return 1
        z, sha256 = download(PACKAGE)
    except FetchError as e:
        print(f"Fineli не скачан: {e}", file=sys.stderr)
        return 1
    print("files:", ", ".join(z.namelist()), "\nsha256:", sha256)
    if args.apply or args.check:
        result = values_for(
            z, sha256, PACKAGE, json.loads(MAP.read_text(encoding="utf-8"))
        )
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
                "fineli_values.json не совпадает с пакетом; выполните --apply",
                file=sys.stderr,
            )
            return 1
        else:
            print(
                f"fineli_values.json совпадает с пакетом: {len(json.loads(text)['products'])} продуктов"
            )
    if args.list:
        food = {r["FOODID"]: r for r in table(z, "food.csv")}
        fi = {r["FOODID"]: r["FOODNAME"] for r in table(z, "foodname_FI.csv")}
        for row in table(z, "foodname_EN.csv"):
            f = food.get(row["FOODID"], {})
            print(
                f"{row['FOODID']} | {f.get('FOODTYPE', '?')} | {f.get('PROCESS', '?')} | {fi.get(row['FOODID'], '')} | {row['FOODNAME']}"
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
