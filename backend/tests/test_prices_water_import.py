from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any
from unittest import mock

import pytest

from geo.models import City, StoreChain
from prices.models import PriceObservation
from prices.services import import_observations, merge_price_sources, public_prices

from .conftest import add_member, household_id

pytestmark = pytest.mark.django_db


def kazan() -> City:
    return City.objects.get(name="Казань")


def test_public_prices_priority_and_idempotent_import() -> None:
    city = kazan()
    magnit = StoreChain.objects.get(pk="magnit")
    today = date.today().isoformat()
    rosstat = [
        {"product_id": "potato", "region": city.region, "price_kop": 4500, "package_size": 1, "package_unit": "kg", "observed_on": today, "source": "Росстат"}
    ]
    assert import_observations(rosstat, "rosstat")["created"] == 1
    assert import_observations(rosstat, "rosstat")["created"] == 0
    entries = {e["product_id"]: e for e in public_prices(city, magnit)}
    assert entries["potato"]["kind"] == "rosstat" and entries["potato"]["loose"] is True
    scraped = [
        {
            "product_id": "potato",
            "chain_id": "magnit",
            "city_id": city.id,
            "price_kop": 9990,
            "package_size": 2,
            "package_unit": "kg",
            "observed_on": today,
            "source": "magnit.ru",
            "external_id": "sku-1",
        }
    ]
    assert import_observations(scraped, "scraped")["created"] == 1
    entries = {e["product_id"]: e for e in public_prices(city, magnit)}
    assert entries["potato"]["kind"] == "scraped"
    bad = import_observations(
        [{"product_id": "unknown", "region": "Нигде", "price_kop": 1, "package_size": 1, "package_unit": "kg", "observed_on": today}], "rosstat"
    )
    assert bad["errors"] and bad["created"] == 0
    own = [{"product_id": "potato", "price_kop": 7000, "package_size": 1, "package_unit": "kg", "date": "2026-01-01", "kind": "manual"}]
    merged = {e["product_id"]: e for e in merge_price_sources(own, list(entries.values()))}
    assert merged["potato"]["price_kop"] == 7000  # own price wins even if older


def test_shared_prices_become_a_community_median(alice: Any, bob: Any) -> None:
    city = kazan()
    for (client, user), price in ((alice, 8000), (bob, 10000)):
        hid = household_id(user)
        client.patch(f"/api/households/{hid}/", {"city_id": city.id, "store_chain_id": "pyaterochka", "share_prices": True}, format="json")
        r = client.post(
            f"/api/households/{hid}/prices/",
            {"product_id": "carrot", "price_kop": price, "package_size": 1, "package_unit": "kg", "date": date.today().isoformat()},
            format="json",
        )
        assert r.json()["shared"] == 1
    obs = PriceObservation.objects.filter(kind="community", product_id="carrot")
    assert obs.count() == 2 and all(len(o.contributor_hash) == 64 for o in obs)
    entry = next(e for e in public_prices(city, StoreChain.objects.get(pk="pyaterochka")) if e["product_id"] == "carrot")
    assert entry["kind"] == "community" and entry["price_kop"] == 9000 and entry["observations"] == 2
    # Not shared without consent.
    client, user = alice
    hid = household_id(user)
    client.patch(f"/api/households/{hid}/", {"share_prices": False}, format="json")
    assert (
        client.post(
            f"/api/households/{hid}/prices/", {"product_id": "onion", "price_kop": 5000, "package_size": 1, "package_unit": "kg"}, format="json"
        ).json()["shared"]
        == 0
    )


def test_store_change_recalculates_cost(alice: Any) -> None:
    client, user = alice
    hid = household_id(user)
    add_member(client, hid)
    city = kazan()
    today = date.today().isoformat()
    import_observations(
        [
            {
                "product_id": p,
                "chain_id": "magnit",
                "city_id": city.id,
                "price_kop": 10000,
                "package_size": 1,
                "package_unit": "kg",
                "observed_on": today,
                "external_id": p,
            }
            for p in ("potato", "carrot", "onion", "beef", "cabbage", "beet")
        ],
        "scraped",
    )
    import_observations(
        [
            {
                "product_id": p,
                "chain_id": "lenta",
                "city_id": city.id,
                "price_kop": 20000,
                "package_size": 1,
                "package_unit": "kg",
                "observed_on": today,
                "external_id": p,
            }
            for p in ("potato", "carrot", "onion", "beef", "cabbage", "beet")
        ],
        "scraped",
    )
    client.patch(f"/api/households/{hid}/", {"city_id": city.id, "store_chain_id": "magnit", "settings": {"slots": ["lunch"], "days": 1}}, format="json")
    menu = client.post(f"/api/households/{hid}/menus/", {"start_date": "2026-10-19", "seed": 1}, format="json").json()
    a = client.get(f"/api/households/{hid}/menus/{menu['id']}/shopping/").json()["totals"]["purchase_kop"]
    client.patch(f"/api/households/{hid}/", {"store_chain_id": "lenta"}, format="json")
    b = client.get(f"/api/households/{hid}/menus/{menu['id']}/shopping/").json()["totals"]["purchase_kop"]
    assert client.get(f"/api/households/{hid}/").json()["store_chain_id"] == "lenta"
    assert b >= a


def test_water_uses_member_timezone_and_day_boundary(alice: Any) -> None:
    client, user = alice
    hid = household_id(user)
    moscow = add_member(client, hid, name="Москва", timezone="Europe/Moscow", water_goal_ml=2000)
    vlad = add_member(client, hid, name="Владивосток", timezone="Asia/Vladivostok")
    # 22:30 UTC = 01:30 next day in Moscow (UTC+3) and 08:30 next day in Vladivostok (UTC+10).
    instant = datetime(2026, 10, 19, 22, 30, tzinfo=UTC)
    with mock.patch("django.utils.timezone.now", return_value=instant):
        client.post(f"/api/households/{hid}/water/", {"member_id": moscow["id"], "amount_ml": 250}, format="json")
        client.post(f"/api/households/{hid}/water/", {"member_id": vlad["id"], "amount_ml": 500}, format="json")
        m = client.get(f"/api/households/{hid}/water/", {"member_id": moscow["id"]}).json()
        v = client.get(f"/api/households/{hid}/water/", {"member_id": vlad["id"]}).json()
    assert m["today"] == "2026-10-20" and m["totals"] == {"2026-10-20": 250}
    assert v["totals"] == {"2026-10-20": 500}
    # Members never mix: Moscow's total does not include Vladivostok's water.
    before = datetime(2026, 10, 19, 20, 30, tzinfo=UTC)  # 23:30 in Moscow
    with mock.patch("django.utils.timezone.now", return_value=before):
        client.post(f"/api/households/{hid}/water/", {"member_id": moscow["id"], "amount_ml": 300}, format="json")
    with mock.patch("django.utils.timezone.now", return_value=instant):
        totals = client.get(f"/api/households/{hid}/water/", {"member_id": moscow["id"]}).json()["totals"]
    assert totals == {"2026-10-19": 300, "2026-10-20": 250}


def test_habits_marks_are_idempotent(alice: Any) -> None:
    client, user = alice
    hid = household_id(user)
    m = add_member(client, hid)
    habit = client.post(f"/api/households/{hid}/habits/", {"member_id": m["id"], "name": "Зарядка"}, format="json").json()
    url = f"/api/households/{hid}/habits/{habit['id']}/marks/"
    client.put(url, {"local_date": "2026-10-19"}, format="json")
    marks = client.put(url, {"local_date": "2026-10-19"}, format="json").json()["marks"]
    assert marks.count("2026-10-19") <= 1


def guest_export(menu: dict[str, Any]) -> dict[str, Any]:
    return {
        "format": "foodo-guest-export",
        "format_version": 1,
        "exported_at": "2026-10-16T10:00:00Z",
        "household": {"name": "Гости", "settings": {"slots": ["lunch"], "days": 1}},
        "members": [
            {
                "id": "g-anya",
                "name": "Аня",
                "age": 34,
                "portion_mode": "simple",
                "portion_factor": 1,
                "restrictions": {"products": [], "categories": [], "allergens": []},
                "preferences": {"liked_recipes": [], "disliked_products": []},
            },
            {
                "id": "g-kid",
                "name": "Миша",
                "age": 7,
                "portion_mode": "simple",
                "portion_factor": 0.5,
                "restrictions": {"products": [], "categories": [], "allergens": ["eggs"]},
                "preferences": {"liked_recipes": [], "disliked_products": []},
            },
        ],
        "menus": [{"id": "gm1", "title": "Гостевое меню", "menu": menu, "shopping_state": {"manual_lines": [], "marks": {}, "seen": {}}}],
        "pantry": [{"id": "p1", "product_id": "potato", "qty": 500, "unit": "g", "location": "Кладовая", "expires": None}],
        "prices": [{"product_id": "potato", "price_kop": 7000, "package_size": 1, "package_unit": "kg", "date": "2026-10-10", "kind": "manual"}],
        "favorites": ["borshch-s-govyadinoy"],
        "custom_recipes": [],
        "water": [{"member_id": "g-anya", "amount_ml": 250, "local_date": "2026-10-15"}],
        "habits": [{"member_id": "g-kid", "name": "Фрукт на перекус", "marks": ["2026-10-15"]}],
    }


def test_guest_import_preview_and_conflict_resolution(alice: Any) -> None:
    from engine import generate_menu, load_seed_catalog

    client, user = alice
    hid = household_id(user)
    existing = add_member(client, hid, name="Аня")
    data = guest_export({})
    req = {
        "start_date": "2026-10-19",
        "days": 1,
        "seed": 4,
        "slots": ["lunch"],
        "members": [
            {**m, "sex": None, "height_cm": None, "weight_kg": None, "activity": None, "goal": None, "kcal_target": None, "vitamin_targets_manual": None}
            for m in data["members"]
        ],
        "settings": {
            "skill": "any",
            "diet_mode": "regular",
            "equipment": ["stove", "oven", "microwave"],
            "max_total_min": None,
            "repeat": {"mode": "unique", "max_uses": 2, "min_gap_days": 2, "cook_days": [], "batch_days": 2, "batch_slots": ["lunch"]},
            "container_days": [],
            "vitamins": {"enabled": False, "target_set": None, "demo": False},
            "budget": {"limit_kop": None, "currency": "RUB"},
            "tolerances": {"energy_pct": 10, "macro_pct": 20},
            "portion_min": 0.5,
            "portion_max": 2,
        },
    }
    data["menus"][0]["menu"] = generate_menu(req, load_seed_catalog())["menu"]
    preview = client.post(f"/api/households/{hid}/import-guest/", {"data": data, "mode": "preview"}, format="json").json()
    anya = next(m for m in preview["members"] if m["guest_id"] == "g-anya")
    assert anya["conflict"]["existing_id"] == existing["id"] and anya["default"] == f"merge:{existing['id']}"
    assert next(m for m in preview["members"] if m["guest_id"] == "g-kid")["conflict"] is None
    result = client.post(
        f"/api/households/{hid}/import-guest/",
        {"data": data, "mode": "apply", "resolution": {"members": {"g-anya": f"merge:{existing['id']}", "g-kid": "add"}}},
        format="json",
    )
    assert result.status_code == 201, result.content
    added = result.json()["added"]
    assert added["members"] == 1 and added["menus"] == 1 and added["pantry"] == 1 and added["water"] == 1
    household = client.get(f"/api/households/{hid}/").json()
    assert sorted(m["name"] for m in household["members"]) == ["Аня", "Миша"]
    menus = client.get(f"/api/households/{hid}/menus/").json()
    menu = client.get(f"/api/households/{hid}/menus/{menus[0]['id']}/").json()["menu"]
    ids = {m["id"] for m in household["members"]}
    assert set(menu["member_ids"]) <= ids
    bad = client.post(f"/api/households/{hid}/import-guest/", {"data": {"format": "nope"}, "mode": "preview"}, format="json")
    assert bad.json()["error"]["code"] == "invalid_import"
