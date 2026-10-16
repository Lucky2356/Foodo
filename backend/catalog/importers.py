"""Parsing of catalog import files. JSON uses the shared format; products may also come as CSV.
Files are only parsed as data — nothing in them is ever executed."""

from __future__ import annotations

import csv
import io
import json
from typing import Any

from engine.nutrition import NUTRIENT_IDS

from .services import ImportResult, upsert_products, upsert_recipes

PRODUCT_CSV_COLUMNS = [
    "id",
    "name",
    "category",
    "department",
    "state",
    "base_unit",
    "edible_fraction",
    "piece_g",
    "density_g_ml",
    "package_size",
    "package_unit",
    "allergens",
    "contains",
    "composition_known",
    "purchasable",
    "source",
    *NUTRIENT_IDS,
]


def _float(value: str) -> float | None:
    value = value.strip().replace(",", ".")
    if value == "":
        return None
    return float(value)


def products_from_csv(text: str) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(text))
    missing = [c for c in ("id", "name", "category", "department", "state", "base_unit", "edible_fraction", "source") if c not in (reader.fieldnames or [])]
    if missing:
        raise ValueError(f"В CSV нет колонок: {', '.join(missing)}")
    products = []
    for row in reader:
        try:
            pkg_size = _float(row.get("package_size", ""))
            products.append(
                {
                    "id": row["id"].strip(),
                    "name": row["name"].strip(),
                    "category": row["category"].strip(),
                    "department": row["department"].strip(),
                    "state": row["state"].strip(),
                    "base_unit": row["base_unit"].strip(),
                    "edible_fraction": _float(row["edible_fraction"]),
                    "piece_g": _float(row.get("piece_g", "")),
                    "density_g_ml": _float(row.get("density_g_ml", "")),
                    "package": {"size": pkg_size, "unit": row.get("package_unit", "").strip()} if pkg_size else None,
                    "allergens": [a for a in row.get("allergens", "").split(";") if a.strip()],
                    "contains": [a for a in row.get("contains", "").split(";") if a.strip()],
                    "composition_known": row.get("composition_known", "true").strip().lower() not in ("false", "0", "нет"),
                    "purchasable": row.get("purchasable", "true").strip().lower() not in ("false", "0", "нет"),
                    "source": row["source"].strip(),
                    "nutrients": {n: _float(row.get(n, "")) for n in NUTRIENT_IDS},
                }
            )
        except ValueError as e:
            raise ValueError(f"Строка {reader.line_num}: {e}") from e
    return products


def import_catalog_file(name: str, content: bytes, *, dry_run: bool) -> dict[str, Any]:
    text = content.decode("utf-8-sig")
    out: dict[str, Any] = {}
    if name.lower().endswith(".csv"):
        out["products"] = upsert_products(products_from_csv(text), dry_run=dry_run).as_dict()
        return out
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("Ожидается JSON-объект с ключами products и/или recipes.")
    if "products" in data:
        out["products"] = upsert_products(data["products"], dry_run=dry_run).as_dict()
        if out["products"]["errors"]:
            return out
    if "recipes" in data:
        out["recipes"] = upsert_recipes(data["recipes"], dry_run=dry_run).as_dict()
    if not out:
        raise ValueError("В файле нет разделов products или recipes.")
    return out


__all__ = ["ImportResult", "import_catalog_file", "products_from_csv", "PRODUCT_CSV_COLUMNS"]
