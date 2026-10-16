"""Catalog helpers; twin of frontend/src/engine/catalog.ts."""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

JSON = dict[str, Any]

SEED_DIR = Path(__file__).resolve().parents[2] / "shared" / "data"


@dataclass
class Catalog:
    products: dict[str, JSON]
    recipes: dict[str, JSON]
    reference: JSON
    target_sets: dict[str, JSON] = field(default_factory=dict)


def build_catalog(products: list[JSON], recipes: list[JSON], reference: JSON, target_sets: list[JSON]) -> Catalog:
    return Catalog(
        products={p["id"]: p for p in products},
        recipes={r["id"]: r for r in recipes},
        reference=reference,
        target_sets={s["id"]: s for s in target_sets},
    )


def load_seed_files(seed_dir: Path = SEED_DIR) -> dict[str, Any]:
    def read(name: str) -> Any:
        return json.loads((seed_dir / name).read_text(encoding="utf-8"))

    return {
        "products": read("products.json")["products"],
        "recipes": read("recipes.json")["recipes"],
        "reference": read("reference.json"),
        "targets": read("nutrient_targets.json")["sets"],
    }


def load_seed_catalog(seed_dir: Path = SEED_DIR) -> Catalog:
    data = load_seed_files(seed_dir)
    return build_catalog(data["products"], data["recipes"], data["reference"], data["targets"])


def recipe_ids(catalog: Catalog) -> list[str]:
    return sorted(catalog.recipes.keys())


def category_lineage(reference: JSON, category_id: str) -> list[str]:
    by_id = {c["id"]: c for c in reference["categories"]}
    result: list[str] = []
    current: str | None = category_id
    seen: set[str] = set()
    while current and current not in seen:
        seen.add(current)
        result.append(current)
        current = by_id.get(current, {}).get("parent")
    return result


@dataclass
class ProductClosure:
    product_ids: set[str]
    categories: set[str]
    allergens: set[str]
    composition_known: bool
    missing_products: list[str]


def product_closure(catalog: Catalog, product_id: str) -> ProductClosure:
    closure = ProductClosure(set(), set(), set(), True, [])
    stack = [product_id]
    while stack:
        pid = stack.pop()
        if pid in closure.product_ids:
            continue
        closure.product_ids.add(pid)
        product = catalog.products.get(pid)
        if product is None:
            closure.composition_known = False
            closure.missing_products.append(pid)
            continue
        if not product["composition_known"]:
            closure.composition_known = False
        for c in category_lineage(catalog.reference, product["category"]):
            closure.categories.add(c)
        for a in product["allergens"]:
            closure.allergens.add(a)
        stack.extend(product["contains"])
    return closure


def technique_rank(reference: JSON, technique_id: str) -> int | None:
    for t in reference["techniques"]:
        if t["id"] == technique_id:
            return int(t["rank"])
    return None


def recipe_skill_rank(reference: JSON, recipe: JSON) -> int | None:
    techniques = recipe.get("techniques")
    if not techniques:
        return None
    rank = 0
    for t in techniques:
        r = technique_rank(reference, t)
        if r is None:
            return None
        if r > rank:
            rank = r
    return rank


def skill_allows(level: str, rank: int | None) -> bool:
    if level == "any":
        return True
    if rank is None:
        return False
    if level == "beginner":
        return rank <= 1
    return rank <= 2


def select_method(recipe: JSON, equipment: list[str]) -> JSON | None:
    available = set(equipment)
    for method in recipe["methods"]:
        if all(e in available for e in method["equipment"]):
            return method
    return None


def find_method(recipe: JSON, method_id: str) -> JSON | None:
    for m in recipe["methods"]:
        if m["id"] == method_id:
            return m
    return None


def snapshot_catalog(menu: JSON, base: Catalog) -> Catalog:
    return Catalog(
        products={**base.products, **menu["snapshot"]["products"]},
        recipes={**base.recipes, **menu["snapshot"]["recipes"]},
        reference=base.reference,
        target_sets=base.target_sets,
    )


def add_to_snapshot(snapshot: JSON, catalog: Catalog, recipe_id: str) -> None:
    recipe = catalog.recipes.get(recipe_id)
    if recipe is None:
        return
    if recipe_id not in snapshot["recipes"]:
        snapshot["recipes"][recipe_id] = copy.deepcopy(recipe)
    for ing in recipe["ingredients"]:
        for pid in product_closure(catalog, ing["product"]).product_ids:
            product = catalog.products.get(pid)
            if product is not None and pid not in snapshot["products"]:
                snapshot["products"][pid] = copy.deepcopy(product)
