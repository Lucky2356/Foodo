from __future__ import annotations

from typing import Any

from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from common.errors import ApiError
from common.pagination import StandardPagination
from engine.catalog import Catalog, product_closure
from engine.nutrition import recipe_nutrition

from .models import Article, Product, Recipe
from .services import build_public_bundle, product_to_json, recipe_to_json


def _csv(value: str | None) -> list[str]:
    return [v for v in (value or "").split(",") if v]


class CatalogBundleView(APIView):
    """The whole public catalog in the shared JSON format (used by the browser engine)."""

    authentication_classes: list = []

    def get(self, request: Request) -> Response | HttpResponse:
        bundle = build_public_bundle()
        etag = f'"catalog-v{bundle["version"]}"'
        if request.headers.get("If-None-Match") == etag:
            return HttpResponse(status=304, headers={"ETag": etag})
        response = Response(bundle)
        response["ETag"] = etag
        response["Cache-Control"] = "public, max-age=300"
        return response


def _bundle_catalog() -> Catalog:
    bundle = build_public_bundle()
    return Catalog(
        products={p["id"]: p for p in bundle["products"]},
        recipes={r["id"]: r for r in bundle["recipes"]},
        reference=bundle["reference"],
        target_sets={s["id"]: s for s in bundle["targets"]},
    )


def recipe_summary(catalog: Catalog, recipe: dict[str, Any]) -> dict[str, Any]:
    n = recipe_nutrition(catalog, recipe, 1)
    per_serving = {k: {"value": v["value"], "complete": v["complete"]} for k, v in n["perServing"].items() if k in ("kcal", "protein", "fat", "carbs")}
    allergens: set[str] = set()
    known = True
    for ing in recipe["ingredients"]:
        c = product_closure(catalog, ing["product"])
        allergens |= c.allergens
        known = known and c.composition_known
    first = recipe["methods"][0]
    return {
        "id": recipe["id"],
        "name": recipe["name"],
        "description": recipe["description"],
        "category": recipe["category"],
        "meal_types": recipe["meal_types"],
        "servings": recipe["servings"],
        "total_min": min(m["total_min"] for m in recipe["methods"]),
        "active_min": first["active_min"],
        "equipment": first["equipment"],
        "diet_tags": recipe["diet_tags"],
        "cuisine": recipe.get("cuisine"),
        "spicy": recipe.get("spicy", 0),
        "kid_friendly": recipe.get("kid_friendly", False),
        "image": recipe.get("image"),
        "per_serving": per_serving,
        "allergens": sorted(allergens),
        "composition_known": known,
    }


class RecipeListView(APIView):
    """Search and filters: ?search=, category=, meal=, max_time=, max_kcal=, exclude_products=,
    exclude_categories=, exclude_allergens=, diet_types=, cuisine=, max_spicy=, kids=1, equipment=,
    ordering=name|time|kcal, page="""

    authentication_classes: list = []

    def get(self, request: Request) -> Response:
        catalog = _bundle_catalog()
        q = request.query_params
        search = (q.get("search") or "").strip().lower()
        excluded_products = set(_csv(q.get("exclude_products")))
        excluded_categories = set(_csv(q.get("exclude_categories")))
        excluded_allergens = set(_csv(q.get("exclude_allergens")))
        # A diet type is a named set of hard restrictions (reference.diet_types); unknown ids are rejected.
        presets = {t["id"]: t for t in catalog.reference.get("diet_types") or []}
        for tid in _csv(q.get("diet_types")):
            preset = presets.get(tid)
            if preset is None:
                raise ApiError("unknown_diet_type", f"Неизвестный тип питания: {tid}.", 400)
            excluded_products |= set(preset["products"])
            excluded_categories |= set(preset["categories"])
            excluded_allergens |= set(preset["allergens"])
        cuisines = set(_csv(q.get("cuisine")))
        max_spicy = q.get("max_spicy")
        if max_spicy is not None and max_spicy not in ("0", "1", "2"):
            raise ApiError("invalid_spicy", "Острота: 0, 1 или 2.", 400)
        kids_only = q.get("kids") == "1"
        equipment = q.get("equipment")
        items = []
        for recipe in catalog.recipes.values():
            if q.get("category") and recipe["category"] != q["category"]:
                continue
            if q.get("meal") and q["meal"] not in recipe["meal_types"]:
                continue
            if cuisines and recipe.get("cuisine") not in cuisines:
                continue
            if max_spicy is not None and (recipe.get("spicy") or 0) > int(max_spicy):
                continue
            if kids_only and recipe.get("kid_friendly") is not True:
                continue
            if search:
                names = " ".join(catalog.products[i["product"]]["name"] for i in recipe["ingredients"] if i["product"] in catalog.products)
                if search not in recipe["name"].lower() and search not in names.lower():
                    continue
            if excluded_products or excluded_categories or excluded_allergens:
                blocked = False
                for ing in recipe["ingredients"]:
                    c = product_closure(catalog, ing["product"])
                    if (
                        c.product_ids & excluded_products
                        or c.categories & excluded_categories
                        or c.allergens & excluded_allergens
                        or (excluded_allergens and not c.composition_known)
                    ):
                        blocked = True
                        break
                if blocked:
                    continue
            if equipment is not None:
                available = set(_csv(equipment))
                if not any(set(m["equipment"]) <= available for m in recipe["methods"]):
                    continue
            summary = recipe_summary(catalog, recipe)
            if q.get("max_time") and summary["total_min"] > int(q["max_time"]):
                continue
            if q.get("max_kcal") and summary["per_serving"]["kcal"]["value"] > float(q["max_kcal"]):
                continue
            items.append(summary)
        ordering = q.get("ordering", "name")
        key = {"time": lambda r: (r["total_min"], r["name"]), "kcal": lambda r: (r["per_serving"]["kcal"]["value"], r["name"])}.get(
            ordering, lambda r: r["name"]
        )
        items.sort(key=key)
        paginator = StandardPagination()
        page = paginator.paginate_queryset(items, request, view=self)  # type: ignore[arg-type]
        return paginator.get_paginated_response(page)


class RecipeDetailView(APIView):
    authentication_classes: list = []

    def get(self, request: Request, recipe_id: str) -> Response:
        recipe = get_object_or_404(Recipe.objects.prefetch_related("ingredients", "methods"), pk=recipe_id, visibility="public")
        catalog = _bundle_catalog()
        data = recipe_to_json(recipe)
        n = recipe_nutrition(catalog, data, 1)
        return Response(
            {
                "recipe": data,
                "nutrition": n,
                "summary": recipe_summary(catalog, data),
                "products": {i["product"]: catalog.products.get(i["product"]) for i in data["ingredients"]},
            }
        )


class ProductListView(APIView):
    authentication_classes: list = []

    def get(self, request: Request) -> Response:
        search = (request.query_params.get("search") or "").strip()
        qs = Product.objects.prefetch_related("allergens", "contains")
        if search:
            qs = qs.filter(Q(name__icontains=search) | Q(id__icontains=search))
        return Response([product_to_json(p) for p in qs[:200]])


class ArticleListView(APIView):
    authentication_classes: list = []

    def get(self, request: Request) -> Response:
        return Response(
            [
                {"id": a.id, "title": a.title, "category": a.category, "category_name": a.category_name, "published": a.published, "summary": a.summary}
                for a in Article.objects.filter(is_published=True)
            ]
        )


class ArticleDetailView(APIView):
    authentication_classes: list = []

    def get(self, request: Request, article_id: str) -> Response:
        a = get_object_or_404(Article, pk=article_id, is_published=True)
        return Response(
            {
                "id": a.id,
                "title": a.title,
                "category": a.category,
                "category_name": a.category_name,
                "published": a.published,
                "summary": a.summary,
                "body": a.body,
            }
        )
