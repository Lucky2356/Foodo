"""Recipe nutrition; twin of frontend/src/engine/nutrition.ts.

contribution = edible g × value per 100 g / 100; per 100 g = total / yield × 100 (only with a known
yield); unknown values stay unknown (complete = False, missing products listed).
"""

from __future__ import annotations

from typing import Any

from .catalog import Catalog
from .units import edible_grams

NUTRIENT_IDS = ("kcal", "protein", "fat", "carbs", "fiber", "vit_a", "vit_c", "vit_d", "vit_e", "vit_b6", "vit_b12", "folate")
VITAMIN_IDS = ("vit_a", "vit_c", "vit_d", "vit_e", "vit_b6", "vit_b12", "folate")

Table = dict[str, dict[str, Any]]


def new_table() -> Table:
    return {nid: {"value": 0, "complete": True, "missing": []} for nid in NUTRIENT_IDS}


def scale_table(table: Table, factor: float) -> Table:
    return {nid: {"value": table[nid]["value"] * factor, "complete": table[nid]["complete"], "missing": list(table[nid]["missing"])} for nid in NUTRIENT_IDS}


def recipe_nutrition(catalog: Catalog, recipe: dict[str, Any], scale: float = 1) -> dict[str, Any]:
    total = new_table()
    unconvertible: list[str] = []
    edible_mass = 0.0
    for ing in recipe["ingredients"]:
        product = catalog.products.get(ing["product"])
        grams = edible_grams(product, ing["qty"] * scale, ing["unit"]) if product is not None else None
        if grams is None:
            unconvertible.append(ing["product"])
            for nid in NUTRIENT_IDS:
                total[nid]["complete"] = False
                if ing["product"] not in total[nid]["missing"]:
                    total[nid]["missing"].append(ing["product"])
            continue
        edible_mass += grams
        for nid in NUTRIENT_IDS:
            per100 = product["nutrients"].get(nid) if product is not None else None
            if per100 is None:
                total[nid]["complete"] = False
                if ing["product"] not in total[nid]["missing"]:
                    total[nid]["missing"].append(ing["product"])
            else:
                total[nid]["value"] += grams * per100 / 100
    yield_g = None if recipe["yield_g"] is None else recipe["yield_g"] * scale
    return {
        "scale": scale,
        "total": total,
        "perServing": scale_table(total, 1 / (recipe["servings"] * scale)),
        "per100g": scale_table(total, 100 / yield_g) if yield_g else None,
        "yieldG": yield_g,
        "edibleMassG": edible_mass,
        "unconvertible": unconvertible,
    }


class NutritionCache:
    def __init__(self, catalog: Catalog) -> None:
        self.catalog = catalog
        self._cache: dict[str, Table] = {}

    def per_serving(self, recipe_id: str) -> Table:
        recipe = self.catalog.recipes[recipe_id]
        key = f"{recipe['id']}@{recipe['version']}"
        table = self._cache.get(key)
        if table is None:
            table = recipe_nutrition(self.catalog, recipe, 1)["perServing"]
            self._cache[key] = table
        return table


def serving_mass_g(recipe: dict[str, Any]) -> float | None:
    return None if recipe["yield_g"] is None else recipe["yield_g"] / recipe["servings"]


def add_into(target: Table, add: Table, factor: float) -> None:
    for nid in NUTRIENT_IDS:
        t = target[nid]
        a = add[nid]
        t["value"] += a["value"] * factor
        if not a["complete"]:
            t["complete"] = False
            for m in a["missing"]:
                if m not in t["missing"]:
                    t["missing"].append(m)
