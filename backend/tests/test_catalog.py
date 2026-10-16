from __future__ import annotations

import json

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from catalog.importers import import_catalog_file
from catalog.models import Product, Recipe, RecipeVersion
from catalog.services import engine_catalog, recipe_to_json, save_recipe
from engine import generate_menu, load_seed_catalog

pytestmark = pytest.mark.django_db


def test_seed_is_idempotent() -> None:
    before = (Product.objects.count(), Recipe.objects.count(), RecipeVersion.objects.count())
    call_command("load_seed", verbosity=0)
    call_command("load_seed", verbosity=0)
    assert (Product.objects.count(), Recipe.objects.count(), RecipeVersion.objects.count()) == before
    assert before[1] >= 40


def test_bundle_has_etag_and_matches_engine_results() -> None:
    client = APIClient()
    r = client.get("/api/catalog/bundle/")
    assert r.status_code == 200
    etag = r["ETag"]
    assert client.get("/api/catalog/bundle/", HTTP_IF_NONE_MATCH=etag).status_code == 304
    # The database catalog must give the engine exactly the same input as the shared seed files.
    req = {
        "start_date": "2026-10-19",
        "days": 7,
        "seed": 42,
        "slots": ["breakfast", "lunch", "snack", "dinner"],
        "members": [
            {
                "id": "m1",
                "name": "Аня",
                "age": 34,
                "sex": "female",
                "height_cm": 168,
                "weight_kg": 62,
                "activity": "moderate",
                "goal": "maintain",
                "portion_mode": "simple",
                "portion_factor": 1,
                "kcal_target": None,
                "restrictions": {"products": [], "categories": [], "allergens": []},
                "preferences": {"liked_recipes": [], "disliked_products": []},
                "vitamin_targets_manual": None,
            }
        ],
        "settings": {
            "skill": "any",
            "diet_mode": "regular",
            "equipment": ["stove", "oven", "microwave"],
            "max_total_min": None,
            "repeat": {"mode": "unique", "max_uses": 2, "min_gap_days": 2, "cook_days": [], "batch_days": 2, "batch_slots": ["lunch", "dinner"]},
            "container_days": [],
            "vitamins": {"enabled": False, "target_set": None, "demo": False},
            "budget": {"limit_kop": None, "currency": "RUB"},
            "tolerances": {"energy_pct": 10, "macro_pct": 20},
            "portion_min": 0.5,
            "portion_max": 2,
        },
    }
    from_db = generate_menu(req, engine_catalog())["menu"]
    from_seed = generate_menu(req, load_seed_catalog())["menu"]
    assert json.loads(json.dumps(from_db["meals"])) == json.loads(json.dumps(from_seed["meals"]))
    assert json.loads(json.dumps(from_db["batches"])) == json.loads(json.dumps(from_seed["batches"]))


def test_recipe_search_and_filters_use_ids_not_names() -> None:
    client = APIClient()
    r = client.get("/api/catalog/recipes/", {"search": "плов"})
    assert [x["id"] for x in r.json()["results"]] == ["plov-s-govyadinoy"]
    banned = client.get("/api/catalog/recipes/", {"exclude_categories": "rice,pasta", "page_size": 100}).json()["results"]
    ids = {x["id"] for x in banned}
    assert "plov-s-govyadinoy" not in ids and "tefteli-v-tomatnom-souse" not in ids and "makarony-po-flotski" not in ids
    egg_free = {x["id"] for x in client.get("/api/catalog/recipes/", {"exclude_allergens": "eggs", "page_size": 100}).json()["results"]}
    assert "salat-tsezar-s-kuritsey" not in egg_free  # mayonnaise contains eggs
    assert "kuritsa-teriyaki-s-risom" not in egg_free  # unknown composition is never «safe»
    by_time = client.get("/api/catalog/recipes/", {"max_time": 10, "page_size": 100}).json()["results"]
    assert by_time and all(x["total_min"] <= 10 for x in by_time)
    detail = client.get("/api/catalog/recipes/pirog-s-kapustoy/").json()
    assert detail["nutrition"]["per100g"] is None


def test_recipe_edit_creates_new_version_and_old_menu_keeps_snapshot() -> None:
    recipe = Recipe.objects.prefetch_related("ingredients", "methods").get(pk="omlet-s-pomidorami")
    data = recipe_to_json(recipe)
    v1 = data["version"]
    _, outcome = save_recipe({**data, "servings": 3})
    assert outcome == "updated"
    assert Recipe.objects.get(pk="omlet-s-pomidorami").version == v1 + 1
    assert RecipeVersion.objects.filter(recipe_id="omlet-s-pomidorami").count() == 2
    _, again = save_recipe({**data, "servings": 3})
    assert again == "unchanged"


def test_import_validates_and_does_not_duplicate() -> None:
    bad = json.dumps(
        {
            "products": [
                {
                    "id": "Bad Id",
                    "name": "",
                    "category": "nope",
                    "department": "",
                    "state": "x",
                    "base_unit": "kg",
                    "edible_fraction": 2,
                    "nutrients": {"kcal": -1, "zinc": 1},
                    "source": "",
                }
            ]
        }
    ).encode()
    result = import_catalog_file("x.json", bad, dry_run=False)
    codes = {e["code"] for e in result["products"]["errors"]}
    assert {"invalid_id", "unknown_category", "invalid_unit", "invalid_fraction", "unknown_nutrient", "invalid_value"} <= codes
    csv_text = (
        "id,name,category,department,state,base_unit,edible_fraction,source,kcal,protein\ntest_turnip,Репа,vegetables,Овощи и фрукты,raw,g,0.85,test,28,0.9\n"
    ).encode()
    first = import_catalog_file("p.csv", csv_text, dry_run=False)
    second = import_catalog_file("p.csv", csv_text, dry_run=False)
    assert first["products"]["created"] == 1
    assert second["products"]["unchanged"] == 1
    assert Product.objects.filter(pk="test_turnip").count() == 1
    assert Product.objects.get(pk="test_turnip").nutrients["fat"] is None


def test_cities_and_chains_for_city() -> None:
    client = APIClient()
    cities = client.get("/api/geo/cities/", {"search": "Казань"}).json()
    kazan = next(c for c in cities if c["name"] == "Казань")
    detail = client.get(f"/api/geo/cities/{kazan['id']}/").json()
    names = {c["name"] for c in detail["chains"]}
    assert {"Пятёрочка", "Магнит", "Бахетле"} <= names
    assert "Самбери" not in names
