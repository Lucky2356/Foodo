"""Catalog serialisation, versioned upserts and the cached engine catalog."""

from __future__ import annotations

import copy
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from django.core.cache import cache
from django.db import transaction

from engine.catalog import Catalog

from .models import (
    Allergen,
    Article,
    CatalogState,
    Category,
    DietTag,
    Equipment,
    NutrientTargetSet,
    Product,
    Recipe,
    RecipeIngredient,
    RecipeMethod,
    RecipeVersion,
    ReferenceData,
    Technique,
)
from .validation import validate_products, validate_recipes

JSON = dict[str, Any]

_suspend_bumps = False


def bump_catalog_version() -> int:
    if _suspend_bumps:
        return CatalogState.current().version
    state = CatalogState.current()
    state.version += 1
    state.save(update_fields=["version", "updated_at"])
    return state.version


@contextmanager
def bulk_catalog_change() -> Iterator[None]:
    """Suspends per-object version bumps during an import and bumps once at the end."""
    global _suspend_bumps
    _suspend_bumps = True
    try:
        yield
    finally:
        _suspend_bumps = False
    bump_catalog_version()


def product_to_json(p: Product) -> JSON:
    return {
        "id": p.id,
        "name": p.name,
        "category": p.category_id,
        "department": p.department,
        "state": p.state,
        "base_unit": p.base_unit,
        "edible_fraction": p.edible_fraction,
        "piece_g": p.piece_g,
        "density_g_ml": p.density_g_ml,
        "spoon_g": p.spoon_g or {},
        "package": {"size": p.package_size, "unit": p.package_unit} if p.package_size else None,
        "allergens": sorted(a.id for a in p.allergens.all()),
        "contains": sorted(c.id for c in p.contains.all()),
        "composition_known": p.composition_known,
        "purchasable": p.purchasable,
        "source": p.source,
        "nutrients": p.nutrients,
    }


def recipe_to_json(r: Recipe) -> JSON:
    return {
        "id": r.id,
        "version": r.version,
        "name": r.name,
        "description": r.description,
        "category": r.category,
        "meal_types": r.meal_types,
        "servings": r.servings,
        "yield_g": r.yield_g,
        "ingredients": [{"product": i.product_id, "qty": i.qty, "unit": i.unit, **({"note": i.note} if i.note else {})} for i in r.ingredients.all()],
        "methods": [
            {"id": m.method_id, "name": m.name, "equipment": m.equipment, "active_min": m.active_min, "total_min": m.total_min, "steps": m.steps}
            for m in r.methods.all()
        ],
        "techniques": r.techniques,
        "diet_tags": r.diet_tags,
        "container_ok": r.container_ok,
        "tip": r.tip or None,
        "storage": r.storage,
        "image": r.image,
        "source": r.source,
        "visibility": r.visibility,
        **({"owner": str(r.owner_household_id)} if r.owner_household_id else {}),
    }


def normalise_product(p: JSON) -> JSON:
    """Incoming product in exactly the shape product_to_json produces (for change detection)."""
    return {
        "id": p["id"],
        "name": p["name"],
        "category": p["category"],
        "department": p["department"],
        "state": p["state"],
        "base_unit": p["base_unit"],
        "edible_fraction": p["edible_fraction"],
        "piece_g": p.get("piece_g"),
        "density_g_ml": p.get("density_g_ml"),
        "spoon_g": p.get("spoon_g") or {},
        "package": p.get("package"),
        "allergens": sorted(p.get("allergens", [])),
        "contains": sorted(p.get("contains", [])),
        "composition_known": p.get("composition_known", True),
        "purchasable": p.get("purchasable", True),
        "source": p["source"],
        "nutrients": p["nutrients"],
    }


def _same(a: Any, b: Any) -> bool:
    # Plain equality: 80 == 80.0, so values read back from FloatFields compare equal to the JSON source.
    return bool(a == b)


def _same_content(a: JSON, b: JSON) -> bool:
    return _same({k: v for k, v in a.items() if k != "version"}, {k: v for k, v in b.items() if k != "version"})


def build_reference() -> JSON:
    ref = copy.deepcopy(ReferenceData.objects.get_or_create(pk=1)[0].data)
    ref["categories"] = [{"id": c.id, "name": c.name, "parent": c.parent_id} for c in Category.objects.all()]
    ref["allergens"] = [{"id": a.id, "name": a.name} for a in Allergen.objects.all()]
    ref["equipment"] = [{"id": e.id, "name": e.name} for e in Equipment.objects.all()]
    ref["techniques"] = [{"id": t.id, "name": t.name, "rank": t.rank} for t in Technique.objects.all()]
    tags = list(DietTag.objects.all())
    ref["diet_tags"] = [{"id": t.id, "name": t.name} for t in tags]
    ref["diet_rules"] = {
        "version": ref.get("diet_rules", {}).get("version", "db"),
        "balanced": {t.id: t.balanced_weight for t in tags if t.balanced_weight is not None},
        "regular": {t.id: t.regular_weight for t in tags if t.regular_weight is not None},
    }
    return ref


def validation_reference() -> JSON:
    ref = build_reference()
    ref["equipment_ids"] = [e["id"] for e in ref["equipment"]]
    ref["technique_ids"] = [t["id"] for t in ref["techniques"]]
    ref["diet_tag_ids"] = [t["id"] for t in ref["diet_tags"]]
    return ref


def target_set_to_json(s: NutrientTargetSet) -> JSON:
    return {
        "id": s.id,
        "name": s.name,
        "status": s.status,
        "demo": s.demo,
        "version": s.version,
        "source": s.source,
        "source_note": s.source_note,
        "min_age": s.min_age,
        "targets": s.targets,
    }


def build_public_bundle() -> JSON:
    """The public catalog in the shared JSON format, cached per catalog version."""
    version = CatalogState.current().version
    key = f"catalog-bundle:v{version}"
    bundle = cache.get(key)
    if bundle is None:
        products = Product.objects.prefetch_related("allergens", "contains")
        recipes = Recipe.objects.filter(visibility="public").prefetch_related("ingredients", "methods")
        bundle = {
            "version": version,
            "products": [product_to_json(p) for p in products],
            "recipes": [recipe_to_json(r) for r in recipes],
            "reference": build_reference(),
            "targets": [target_set_to_json(s) for s in NutrientTargetSet.objects.all()],
        }
        cache.set(key, bundle, 60 * 60 * 24)
    return bundle


def engine_catalog(household_id: Any | None = None) -> Catalog:
    """Engine catalog: the public catalog plus the household's private recipes."""
    bundle = build_public_bundle()
    catalog = Catalog(
        products={p["id"]: p for p in bundle["products"]},
        recipes={r["id"]: r for r in bundle["recipes"]},
        reference=bundle["reference"],
        target_sets={s["id"]: s for s in bundle["targets"]},
    )
    if household_id is not None:
        for r in Recipe.objects.filter(visibility="private", owner_household_id=household_id).prefetch_related("ingredients", "methods"):
            catalog.recipes[r.id] = recipe_to_json(r)
    return catalog


@transaction.atomic
def load_reference(reference: JSON) -> None:
    keep = {k: v for k, v in reference.items() if k not in ("categories", "allergens", "equipment", "techniques", "diet_tags")}
    ReferenceData.objects.update_or_create(pk=1, defaults={"data": keep})
    pending = list(reference["categories"])
    position = 0
    while pending:
        progressed = False
        for c in list(pending):
            if c["parent"] is None or Category.objects.filter(pk=c["parent"]).exists():
                position += 1
                Category.objects.update_or_create(id=c["id"], defaults={"name": c["name"], "parent_id": c["parent"], "position": position})
                pending.remove(c)
                progressed = True
        if not progressed:
            raise ValueError("Категории ссылаются на несуществующих родителей.")
    for i, a in enumerate(reference["allergens"]):
        Allergen.objects.update_or_create(id=a["id"], defaults={"name": a["name"], "position": i})
    for i, e in enumerate(reference["equipment"]):
        Equipment.objects.update_or_create(id=e["id"], defaults={"name": e["name"], "position": i})
    for i, t in enumerate(reference["techniques"]):
        Technique.objects.update_or_create(id=t["id"], defaults={"name": t["name"], "rank": t["rank"], "position": i})
    rules = reference.get("diet_rules", {})
    for i, t in enumerate(reference["diet_tags"]):
        DietTag.objects.update_or_create(
            id=t["id"],
            defaults={
                "name": t["name"],
                "position": i,
                "balanced_weight": rules.get("balanced", {}).get(t["id"]),
                "regular_weight": rules.get("regular", {}).get(t["id"]),
            },
        )


class ImportResult:
    def __init__(self) -> None:
        self.created = 0
        self.updated = 0
        self.unchanged = 0
        self.errors: list[dict[str, str]] = []

    def as_dict(self) -> JSON:
        return {"created": self.created, "updated": self.updated, "unchanged": self.unchanged, "errors": self.errors}


@transaction.atomic
def upsert_products(products: list[JSON], *, dry_run: bool = False) -> ImportResult:
    result = ImportResult()
    result.errors = validate_products(
        products,
        set(Category.objects.values_list("id", flat=True)),
        set(Allergen.objects.values_list("id", flat=True)),
        set(Product.objects.values_list("id", flat=True)),
    )
    if result.errors or dry_run:
        return result
    with bulk_catalog_change():
        for p in products:
            pkg = p.get("package")
            defaults = {
                "name": p["name"],
                "category_id": p["category"],
                "department": p["department"],
                "state": p["state"],
                "base_unit": p["base_unit"],
                "edible_fraction": p["edible_fraction"],
                "piece_g": p.get("piece_g"),
                "density_g_ml": p.get("density_g_ml"),
                "spoon_g": p.get("spoon_g") or {},
                "package_size": pkg["size"] if pkg else None,
                "package_unit": pkg["unit"] if pkg else "",
                "composition_known": p.get("composition_known", True),
                "purchasable": p.get("purchasable", True),
                "source": p["source"],
                "nutrients": p["nutrients"],
            }
            existing = Product.objects.filter(pk=p["id"]).prefetch_related("allergens", "contains").first()
            if existing is not None and _same(product_to_json(existing), normalise_product(p)):
                result.unchanged += 1
                continue
            obj, created = Product.objects.update_or_create(id=p["id"], defaults=defaults)
            obj.allergens.set(p.get("allergens", []))
            if created:
                result.created += 1
            else:
                result.updated += 1
        # Composition is linked after all products exist (a product may reference a later one).
        for p in products:
            Product.objects.get(pk=p["id"]).contains.set(p.get("contains", []))
    return result


def save_recipe(data: JSON, owner_household_id: Any | None = None) -> tuple[Recipe, str]:
    """Creates or updates a recipe; a content change creates a new frozen version.
    Returns the recipe and one of "created", "updated", "unchanged"."""
    existing = Recipe.objects.filter(pk=data["id"]).prefetch_related("ingredients", "methods").first()
    incoming = {**data, "visibility": "private" if owner_household_id else "public"}
    incoming.pop("owner", None)
    if existing is not None:
        current = recipe_to_json(existing)
        current.pop("owner", None)
        normalised = {**current, **{k: incoming.get(k, current[k]) for k in current}}
        normalised["tip"] = normalised["tip"] or None
        if _same_content(current, normalised):
            return existing, "unchanged"
    recipe = existing or Recipe(id=data["id"])
    recipe.version = (existing.version + 1) if existing else max(1, int(data.get("version", 1)))
    recipe.name = data["name"]
    recipe.description = data.get("description", "")
    recipe.category = data["category"]
    recipe.meal_types = data["meal_types"]
    recipe.servings = data["servings"]
    recipe.yield_g = data.get("yield_g")
    recipe.techniques = data.get("techniques")
    recipe.diet_tags = data.get("diet_tags", [])
    recipe.container_ok = data["container_ok"]
    recipe.tip = data.get("tip") or ""
    recipe.storage = data.get("storage")
    recipe.image = data.get("image")
    recipe.source = data.get("source", "user")
    recipe.visibility = "private" if owner_household_id else "public"
    recipe.owner_household_id = owner_household_id
    recipe.save()
    recipe.ingredients.all().delete()
    recipe.methods.all().delete()
    RecipeIngredient.objects.bulk_create(
        RecipeIngredient(recipe=recipe, position=i, product_id=ing["product"], qty=ing["qty"], unit=ing["unit"], note=ing.get("note") or "")
        for i, ing in enumerate(data["ingredients"])
    )
    RecipeMethod.objects.bulk_create(
        RecipeMethod(
            recipe=recipe,
            position=i,
            method_id=m["id"],
            name=m["name"],
            equipment=m["equipment"],
            active_min=m["active_min"],
            total_min=m["total_min"],
            steps=m["steps"],
        )
        for i, m in enumerate(data["methods"])
    )
    fresh = Recipe.objects.prefetch_related("ingredients", "methods").get(pk=recipe.pk)
    RecipeVersion.objects.update_or_create(recipe=fresh, version=fresh.version, defaults={"data": recipe_to_json(fresh)})
    if not owner_household_id:
        bump_catalog_version()
    return fresh, "created" if existing is None else "updated"


@transaction.atomic
def upsert_recipes(recipes: list[JSON], *, dry_run: bool = False) -> ImportResult:
    result = ImportResult()
    result.errors = validate_recipes(recipes, set(Product.objects.values_list("id", flat=True)), validation_reference())
    if result.errors or dry_run:
        return result
    with bulk_catalog_change():
        for data in recipes:
            _, outcome = save_recipe(data)
            setattr(result, outcome, getattr(result, outcome) + 1)
    return result


@transaction.atomic
def upsert_target_sets(sets: list[JSON]) -> ImportResult:
    result = ImportResult()
    with bulk_catalog_change():
        for s in sets:
            _, created = NutrientTargetSet.objects.update_or_create(
                id=s["id"],
                defaults={
                    "name": s["name"],
                    "status": s["status"],
                    "demo": s["demo"],
                    "version": s["version"],
                    "source": s["source"],
                    "source_note": s.get("source_note", ""),
                    "min_age": s.get("min_age"),
                    "targets": s["targets"],
                },
            )
            result.created += int(created)
            result.updated += int(not created)
    return result


@transaction.atomic
def upsert_articles(articles: list[JSON]) -> ImportResult:
    result = ImportResult()
    for a in articles:
        _, created = Article.objects.update_or_create(
            id=a["id"],
            defaults={
                "title": a["title"],
                "category": a["category"],
                "category_name": a["category_name"],
                "published": a["published"],
                "summary": a["summary"],
                "body": a["body"],
            },
        )
        result.created += int(created)
        result.updated += int(not created)
    return result
