from __future__ import annotations

import threading
from typing import Any

import pytest
from django.db import connection
from rest_framework.test import APIClient

from common.errors import ApiError
from households.models import CookConfirmation, PantryItem

from .conftest import add_member, household_id

pytestmark = pytest.mark.django_db


def setup_family(client: APIClient, hid: str, **settings: Any) -> None:
    add_member(client, hid, name="Аня")
    add_member(client, hid, name="Борис", age=36)
    if settings:
        client.patch(f"/api/households/{hid}/", {"settings": settings}, format="json")


def test_generate_menu_and_shopping(alice: Any) -> None:
    client, user = alice
    hid = household_id(user)
    setup_family(client, hid, plan={"repeat": {"mode": "unique"}}, slots=["breakfast", "lunch", "snack", "dinner"], days=7)
    r = client.post(f"/api/households/{hid}/menus/", {"start_date": "2026-10-19", "seed": 42}, format="json")
    assert r.status_code == 201, r.content
    menu = r.json()
    assert len(menu["menu"]["meals"]) == 28
    assert menu["menu"]["unfilled"] == []
    shopping = client.get(f"/api/households/{hid}/menus/{menu['id']}/shopping/").json()
    assert len(shopping["lines"]) > 10
    assert shopping["budget"]["status"] == "none"
    report = client.get(f"/api/households/{hid}/menus/{menu['id']}/report/").json()
    assert {r["name"] for r in report} == {"Аня", "Борис"}


def test_rice_and_pasta_ban_in_server_menu(alice: Any) -> None:
    client, user = alice
    hid = household_id(user)
    ban = {"products": [], "categories": ["rice", "pasta"], "allergens": []}
    add_member(client, hid, restrictions=ban)
    menu = client.post(f"/api/households/{hid}/menus/", {"start_date": "2026-10-19", "days": 7, "seed": 5}, format="json").json()
    shopping = client.get(f"/api/households/{hid}/menus/{menu['id']}/shopping/").json()
    assert not {"rice_white_dry", "pasta_dry", "spaghetti_dry", "egg_noodles_dry"} & {ln["product_id"] for ln in shopping["lines"]}
    item = next(i for m in menu["menu"]["meals"] for i in m["items"])
    r = client.post(
        f"/api/households/{hid}/menus/{menu['id']}/ops/", {"op": {"op": "replace", "item_id": item["id"], "recipe_id": "plov-s-govyadinoy"}}, format="json"
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "restriction_violation"


def test_ops_with_revision_conflict_and_manual_lines_survive(alice: Any) -> None:
    client, user = alice
    hid = household_id(user)
    setup_family(client, hid)
    menu = client.post(f"/api/households/{hid}/menus/", {"start_date": "2026-10-19", "days": 3, "seed": 9}, format="json").json()
    mid = menu["id"]
    client.patch(f"/api/households/{hid}/menus/{mid}/shopping/", {"manual_lines": [{"id": "manual:1", "name": "Салфетки", "price_kop": None}]}, format="json")
    dinner = next(m for m in menu["menu"]["meals"] if m["slot"] == "dinner")
    r = client.post(
        f"/api/households/{hid}/menus/{mid}/ops/",
        {"op": {"op": "replace", "item_id": dinner["items"][0]["id"], "recipe_id": None}, "expected_revision": 1},
        format="json",
    )
    assert r.status_code == 200
    assert r.json()["revision"] == 2
    stale = client.post(
        f"/api/households/{hid}/menus/{mid}/ops/",
        {"op": {"op": "pin", "item_id": dinner["items"][0]["id"], "pinned": True}, "expected_revision": 1},
        format="json",
    )
    assert stale.status_code == 409
    shopping = client.get(f"/api/households/{hid}/menus/{mid}/shopping/").json()
    assert [m["name"] for m in shopping["manual_lines"]] == ["Салфетки"]
    assert shopping["budget"]["status"] == "none"


def test_cooking_is_deducted_once_even_when_repeated(alice: Any) -> None:
    client, user = alice
    hid = household_id(user)
    add_member(client, hid)
    client.patch(f"/api/households/{hid}/", {"settings": {"slots": ["lunch"], "days": 1}}, format="json")
    menu = client.post(f"/api/households/{hid}/menus/", {"start_date": "2026-10-19", "seed": 1}, format="json").json()
    batch = menu["menu"]["batches"][0]
    shopping = client.get(f"/api/households/{hid}/menus/{menu['id']}/shopping/").json()
    line = next(ln for ln in shopping["lines"] if ln["convertible"] and ln["unit"] == "g")
    client.post(f"/api/households/{hid}/pantry/", {"product_id": line["product_id"], "qty": line["needed"] * 3}, format="json")
    url = f"/api/households/{hid}/menus/{menu['id']}/batches/{batch['id']}/cook/"
    first = client.post(url)
    second = client.post(url)
    assert first.status_code == 201 and second.status_code == 200
    assert second.json()["created"] is False
    left = PantryItem.objects.get(household_id=hid, product_id=line["product_id"]).qty
    assert left == pytest.approx(line["needed"] * 2, rel=1e-9)
    assert CookConfirmation.objects.filter(menu_id=menu["id"]).count() == 1


@pytest.mark.django_db(transaction=True)
def test_concurrent_cook_confirmations_deduct_once() -> None:
    from .conftest import make_client

    client, user = make_client("race@example.com")
    hid = household_id(user)
    add_member(client, hid)
    client.patch(f"/api/households/{hid}/", {"settings": {"slots": ["lunch"], "days": 1}}, format="json")
    menu = client.post(f"/api/households/{hid}/menus/", {"start_date": "2026-10-19", "seed": 1}, format="json").json()
    batch = menu["menu"]["batches"][0]
    line = next(ln for ln in client.get(f"/api/households/{hid}/menus/{menu['id']}/shopping/").json()["lines"] if ln["convertible"])
    client.post(f"/api/households/{hid}/pantry/", {"product_id": line["product_id"], "qty": line["needed"] * 4}, format="json")
    url = f"/api/households/{hid}/menus/{menu['id']}/batches/{batch['id']}/cook/"
    statuses: list[int] = []

    def worker() -> None:
        c = APIClient()
        c.cookies = client.cookies
        statuses.append(c.post(url).status_code)
        connection.close()

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(statuses).count(201) == 1
    assert CookConfirmation.objects.filter(menu_id=menu["id"]).count() == 1
    assert PantryItem.objects.get(household_id=hid, product_id=line["product_id"]).qty == pytest.approx(line["needed"] * 3, rel=1e-9)


def test_purchase_transfer_is_idempotent(alice: Any) -> None:
    client, user = alice
    hid = household_id(user)
    add_member(client, hid)
    client.patch(f"/api/households/{hid}/", {"settings": {"slots": ["lunch"], "days": 1}}, format="json")
    menu = client.post(f"/api/households/{hid}/menus/", {"start_date": "2026-10-19", "seed": 3}, format="json").json()
    lines = client.get(f"/api/households/{hid}/menus/{menu['id']}/shopping/").json()["lines"]
    target = next(ln for ln in lines if ln["convertible"])
    url = f"/api/households/{hid}/menus/{menu['id']}/shopping/transfer/"
    assert client.post(url, {"line_ids": [target["id"]]}, format="json").json()["added"] == [target["id"]]
    assert client.post(url, {"line_ids": [target["id"]]}, format="json").json()["skipped"] == [target["id"]]
    items = PantryItem.objects.filter(household_id=hid, product_id=target["product_id"])
    assert items.count() == 1
    # Whole packages go to the pantry, and this menu's list and budget stay as they were.
    assert items.get().qty == target["buy_qty"]
    after = client.get(f"/api/households/{hid}/menus/{menu['id']}/shopping/").json()
    moved = next(ln for ln in after["lines"] if ln["id"] == target["id"])
    assert moved["to_buy"] == target["to_buy"]
    assert moved["transferred"] is True


def test_budget_with_own_prices_and_unconfirmed_state(alice: Any) -> None:
    client, user = alice
    hid = household_id(user)
    add_member(client, hid)
    client.patch(f"/api/households/{hid}/", {"settings": {"slots": ["lunch"], "days": 1, "plan": {"budget": {"limit_kop": 100}}}}, format="json")
    menu = client.post(f"/api/households/{hid}/menus/", {"start_date": "2026-10-19", "seed": 3}, format="json").json()
    shopping = client.get(f"/api/households/{hid}/menus/{menu['id']}/shopping/").json()
    assert shopping["budget"]["status"] == "unconfirmed"
    entries = [
        {
            "product_id": ln["product_id"],
            "price_kop": 10000,
            "package_size": 1,
            "package_unit": "kg" if ln["unit"] == "g" else ("l" if ln["unit"] == "ml" else "pcs"),
            "date": "2026-10-10",
        }
        for ln in shopping["lines"]
    ]
    assert client.post(f"/api/households/{hid}/prices/", {"entries": entries}, format="json").status_code == 201
    priced = client.get(f"/api/households/{hid}/menus/{menu['id']}/shopping/").json()
    unpriced = [ln for ln in priced["lines"] if ln["purchase_cost_kop"] is None and ln["to_buy"] > 0]
    assert priced["budget"]["status"] == ("exceeded" if not unpriced else "unconfirmed")


def test_member_diet_types_spice_and_weekend_limit_round_trip() -> None:
    from households.validation import validate_member, validate_plan_settings

    m = validate_member({"name": "Миша", "age": 7, "diet_types": ["vegetarian"], "spice_tolerance": 0, "preferences": {"liked_products": ["banana"]}})
    assert m["diet_types"] == ["vegetarian"] and m["spice_tolerance"] == 0
    assert m["preferences"]["liked_products"] == ["banana"]
    with pytest.raises(ApiError):
        validate_member({"name": "X", "spice_tolerance": 3})
    # Settings saved before the weekend limit existed keep one limit for every day.
    legacy = validate_plan_settings({"max_total_min": 30})
    assert legacy["max_total_min_weekend"] == 30
    fresh = validate_plan_settings({"max_total_min": 30, "max_total_min_weekend": None, "cuisines": ["italian"], "diet_mode": "high_protein"})
    assert fresh["max_total_min_weekend"] is None and fresh["cuisines"] == ["italian"]


def test_cooked_batches_leave_the_shopping_list(alice: Any) -> None:
    client, user = alice
    hid = household_id(user)
    add_member(client, hid)
    client.patch(f"/api/households/{hid}/", {"settings": {"slots": ["lunch"], "days": 1}}, format="json")
    menu = client.post(f"/api/households/{hid}/menus/", {"start_date": "2026-10-19", "seed": 1}, format="json").json()
    url = f"/api/households/{hid}/menus/{menu['id']}/shopping/"
    assert client.get(url).json()["lines"]
    for b in menu["menu"]["batches"]:
        client.post(f"/api/households/{hid}/menus/{menu['id']}/batches/{b['id']}/cook/")
    assert client.get(url).json()["lines"] == []
