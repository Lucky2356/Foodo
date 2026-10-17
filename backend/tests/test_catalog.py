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


def test_seed_reload_keeps_admin_edits_and_applies_seed_changes(tmp_path) -> None:
    """load_seed runs on every container start: it must not revert admin corrections of rows the
    seed did not change, but must apply rows the new seed did change."""
    from django.conf import settings

    potato = Product.objects.get(pk="potato")
    potato.name = "Картофель (исправлено администратором)"
    potato.save()
    call_command("load_seed", verbosity=0)
    assert Product.objects.get(pk="potato").name == "Картофель (исправлено администратором)"

    seed = tmp_path / "seed"
    import shutil

    shutil.copytree(settings.FOODO_SEED_DIR, seed)
    products = json.loads((seed / "products.json").read_text(encoding="utf-8"))
    carrot = next(p for p in products["products"] if p["id"] == "carrot")
    carrot["name"] = "Морковь столовая"
    (seed / "products.json").write_text(json.dumps(products, ensure_ascii=False), encoding="utf-8")
    call_command("load_seed", "--seed-dir", str(seed), verbosity=0)
    assert Product.objects.get(pk="carrot").name == "Морковь столовая"
    assert Product.objects.get(pk="potato").name == "Картофель (исправлено администратором)"


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


def _all_recipe_ids(client: APIClient, **params: str) -> set[str]:
    """Walks every page: absence checks are only meaningful over the whole catalog."""
    ids: set[str] = set()
    page = 1
    while True:
        r = client.get("/api/catalog/recipes/", {**params, "page_size": 100, "page": page}).json()
        ids |= {x["id"] for x in r["results"]}
        if not r.get("next"):
            return ids
        page += 1


def test_recipe_search_and_filters_use_ids_not_names() -> None:
    client = APIClient()
    r = client.get("/api/catalog/recipes/", {"search": "плов"})
    assert {x["id"] for x in r.json()["results"]} == {"plov-s-govyadinoy", "plov-s-kuritsey"}
    everything = _all_recipe_ids(client)
    assert len(everything) >= 300
    ids = _all_recipe_ids(client, exclude_categories="rice,pasta")
    assert {"plov-s-govyadinoy", "plov-s-kuritsey", "tefteli-v-tomatnom-souse", "makarony-po-flotski"} <= everything
    assert not ids & {"plov-s-govyadinoy", "plov-s-kuritsey", "tefteli-v-tomatnom-souse", "makarony-po-flotski"}
    egg_free = _all_recipe_ids(client, exclude_allergens="eggs")
    assert "salat-tsezar-s-kuritsey" not in egg_free  # mayonnaise contains eggs
    assert "kuritsa-teriyaki-s-risom" not in egg_free  # unknown composition is never «safe»
    assert "ovsyanka-s-orehami-i-myodom" in egg_free
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


def test_seed_imports_collected_prices_once(tmp_path) -> None:
    import shutil

    from django.conf import settings

    from prices.models import PriceObservation

    seed = tmp_path / "seed"
    shutil.copytree(settings.FOODO_SEED_DIR, seed)
    (seed / "prices").mkdir(exist_ok=True)
    region = "Республика Татарстан"
    observation = {
        "product_id": "potato",
        "region": region,
        "price_kop": 4550,
        "package_size": 1,
        "package_unit": "kg",
        "loose": True,
        # A date no published Rosstat file has: the seed may also carry real prices for the region.
        "observed_on": "2000-01-31",
    }
    (seed / "prices" / "rosstat.json").write_text(json.dumps({"kind": "rosstat", "observations": [observation]}, ensure_ascii=False), encoding="utf-8")
    (seed / "prices" / "status.json").write_text("{}", encoding="utf-8")
    before = PriceObservation.objects.count()
    call_command("load_seed", "--seed-dir", str(seed), verbosity=0)
    call_command("load_seed", "--seed-dir", str(seed), verbosity=0)
    assert PriceObservation.objects.count() == before + 1
    assert PriceObservation.objects.get(kind="rosstat", region=region, product_id="potato", observed_on="2000-01-31").price_kop == 4550


def test_import_accepts_only_https_or_self_hosted_photo_urls() -> None:
    from pathlib import Path

    seed = json.loads((Path(__file__).resolve().parents[2] / "shared/data/recipes.json").read_text(encoding="utf-8"))
    recipe = dict(seed["recipes"][0])

    def image_errors(url: str) -> list[dict]:
        recipe["image"] = {
            "url": url,
            "source": "Фото: автор, Wikimedia Commons",
            "license": "CC BY 4.0",
            "page_url": "https://commons.wikimedia.org/wiki/File:X.jpg",
        }
        result = import_catalog_file("r.json", json.dumps({"recipes": [recipe]}).encode(), dry_run=True)
        return [e for e in result["recipes"]["errors"] if e["code"] == "invalid_image"]

    assert image_errors(f"photos/{recipe['id']}.webp") == []
    assert image_errors("https://upload.wikimedia.org/x.jpg") == []
    assert image_errors("javascript:alert(1)") != []
    assert image_errors("http://example.com/x.jpg") != []
    assert image_errors("photos/../../secret.webp") != []


def test_recipe_filters_by_diet_type_cuisine_spice_and_kids() -> None:
    client = APIClient()

    def ids(params: dict) -> set[str]:
        out: set[str] = set()
        page = 1
        while True:
            r = client.get("/api/catalog/recipes/", {**params, "page_size": 100, "page": page})
            assert r.status_code == 200, r.content
            body = r.json()
            out |= {x["id"] for x in body["results"]}
            if not body.get("next"):
                return out
            page += 1

    everything = ids({})
    vegetarian = ids({"diet_types": "vegetarian"})
    assert vegetarian and vegetarian < everything
    catalog = engine_catalog()
    for rid in vegetarian:
        for ing in catalog.recipes[rid]["ingredients"]:
            cats = catalog.products[ing["product"]]["category"]
            assert cats not in {"beef", "pork", "poultry", "lamb", "meat", "offal", "processed_meat", "fish", "seafood", "fish_seafood"}
    assert client.get("/api/catalog/recipes/", {"diet_types": "paleo"}).status_code == 400
    assert client.get("/api/catalog/recipes/", {"max_spicy": "9"}).status_code == 400
    first = Recipe.objects.prefetch_related("ingredients", "methods").order_by("id").first()
    assert first is not None
    save_recipe({**recipe_to_json(first), "cuisine": "italian", "spicy": 2, "kid_friendly": True})
    assert ids({"cuisine": "italian"}) >= {first.id}
    assert first.id not in ids({"max_spicy": "1"})
    assert first.id in ids({"kids": "1"})
    summary = client.get("/api/catalog/recipes/", {"cuisine": "italian"}).json()["results"][0]
    assert {"cuisine", "spicy", "kid_friendly"} <= set(summary)
