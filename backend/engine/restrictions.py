"""Hard restrictions and kitchen checks; twin of frontend/src/engine/restrictions.ts."""

from __future__ import annotations

from typing import Any

from .catalog import Catalog, product_closure, recipe_skill_rank, select_method, skill_allows

JSON = dict[str, Any]

REASON_MESSAGES = {
    "meal_type": "не подходит для этого приёма пищи",
    "equipment": "нужна техника, которой нет",
    "skill": "нужен более высокий уровень готовки",
    "skill_unknown": "сложность рецепта не проверена",
    "time": "готовится дольше заданного лимита",
    "container": "не подходит для обеда в контейнере",
    "restriction": "содержит запрещённый продукт, категорию или аллерген",
    "composition_unknown": "состав ингредиента неизвестен, безопасность не подтверждена",
    "repeat": "уже использован (режим повторов)",
    "spicy": "острее, чем допускает участник",
}

DEFAULT_SPICE_TOLERANCE = 1


def has_restrictions(r: JSON) -> bool:
    return len(r["products"]) + len(r["categories"]) + len(r["allergens"]) > 0


def recipe_violations(catalog: Catalog, recipe: JSON, restrictions: JSON) -> list[JSON]:
    violations: list[JSON] = []
    if not has_restrictions(restrictions):
        return violations
    for ing in recipe["ingredients"]:
        closure = product_closure(catalog, ing["product"])
        for p in restrictions["products"]:
            if p in closure.product_ids:
                violations.append({"code": "product", "target": p, "via": ing["product"]})
        for c in restrictions["categories"]:
            if c in closure.categories:
                violations.append({"code": "category", "target": c, "via": ing["product"]})
        for a in restrictions["allergens"]:
            if a in closure.allergens:
                violations.append({"code": "allergen", "target": a, "via": ing["product"]})
        if not closure.composition_known:
            violations.append({"code": "composition_unknown", "target": "*", "via": ing["product"]})
    return violations


def merge_restrictions(items: list[JSON]) -> JSON:
    products: set[str] = set()
    categories: set[str] = set()
    allergens: set[str] = set()
    for r in items:
        products.update(r["products"])
        categories.update(r["categories"])
        allergens.update(r["allergens"])
    return {"products": sorted(products), "categories": sorted(categories), "allergens": sorted(allergens)}


def effective_restrictions(catalog: Catalog, member: JSON) -> JSON:
    """The member's own restrictions plus those of every selected diet type (vegetarian, gluten-free, …)."""
    types = member.get("diet_types") or []
    if not types:
        return member["restrictions"]
    refs = catalog.reference.get("diet_types") or []
    parts: list[JSON] = [member["restrictions"]]
    for tid in types:
        t = next((x for x in refs if x["id"] == tid), None)
        if t is not None:
            parts.append({"products": t["products"], "categories": t["categories"], "allergens": t["allergens"]})
    return merge_restrictions(parts)


def spice_tolerance(member: JSON) -> int:
    tol = member.get("spice_tolerance")
    return DEFAULT_SPICE_TOLERANCE if tol is None else int(tol)


def recipe_spice(recipe: JSON) -> int:
    return int(recipe.get("spicy") or 0)


def is_recipe_safe_for(catalog: Catalog, recipe: JSON, member: JSON) -> bool:
    """Hard check for one member: restrictions (with diet types) and the spiciness they accept."""
    if recipe_spice(recipe) > spice_tolerance(member):
        return False
    return len(recipe_violations(catalog, recipe, effective_restrictions(catalog, member))) == 0


def recipe_has_liked_product(catalog: Catalog, recipe: JSON, member: JSON) -> bool:
    liked = member["preferences"].get("liked_products") or []
    if not liked:
        return False
    for ing in recipe["ingredients"]:
        closure = product_closure(catalog, ing["product"])
        for p in liked:
            if p in closure.product_ids:
                return True
    return False


def recipe_has_disliked_product(catalog: Catalog, recipe: JSON, member: JSON) -> bool:
    disliked = member["preferences"]["disliked_products"]
    if not disliked:
        return False
    for ing in recipe["ingredients"]:
        closure = product_closure(catalog, ing["product"])
        for p in disliked:
            if p in closure.product_ids:
                return True
    return False


def kitchen_check(
    catalog: Catalog,
    recipe: JSON,
    slot: str,
    equipment: list[str],
    skill: str,
    max_total_min: int | None,
    container: bool,
    main_course: bool = True,
) -> JSON:
    reasons: list[str] = []
    # main_course is False when the slot needs a main course and the dish is not one (see the generator).
    if slot not in recipe["meal_types"] or not main_course:
        reasons.append("meal_type")
    method = select_method(recipe, equipment)
    if method is None:
        reasons.append("equipment")
    rank = recipe_skill_rank(catalog.reference, recipe)
    if not skill_allows(skill, rank):
        reasons.append("skill_unknown" if rank is None else "skill")
    if method is not None and max_total_min is not None and method["total_min"] > max_total_min:
        reasons.append("time")
    if container and not recipe["container_ok"]:
        reasons.append("container")
    return {"method": method if not reasons else None, "reasons": reasons}
