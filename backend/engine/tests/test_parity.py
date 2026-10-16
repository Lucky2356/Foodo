"""The Python engine must reproduce shared/fixtures/engine exactly (see frontend parity.test.ts)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from engine import EngineError, apply_menu_op, compute_shopping, empty_shopping_state, generate_menu, load_seed_catalog, menu_report
from engine.basics import Rng
from engine.nutrition import recipe_nutrition

FIXTURES = Path(__file__).resolve().parents[3] / "shared" / "fixtures" / "engine"
CASES = json.loads((FIXTURES / "cases.json").read_text(encoding="utf-8"))["cases"]


def resolve_item(menu: dict[str, Any], placeholder: str) -> str:
    meals = [m for m in menu["meals"] if m["items"]]
    if placeholder == "FIRST_DINNER":
        return next((m["items"][0]["id"] for m in meals if m["slot"] == "dinner"), "missing")
    if placeholder == "FIRST_LUNCH":
        return next((m["items"][0]["id"] for m in meals if m["slot"] == "lunch"), "missing")
    if placeholder == "FIRST_SHARED":
        for m in meals:
            for i in m["items"]:
                if len(i["portions"]) > 1:
                    return i["id"]
        return "missing"
    return placeholder


def comparable_menu(menu: dict[str, Any]) -> dict[str, Any]:
    rest = {k: v for k, v in menu.items() if k != "snapshot"}
    rest["snapshot_ids"] = {"recipes": sorted(menu["snapshot"]["recipes"]), "products": sorted(menu["snapshot"]["products"])}
    return rest


def normalise(value: Any) -> Any:
    """JSON round trip, the same normalisation the TypeScript side applies before comparing."""
    return json.loads(json.dumps(value, ensure_ascii=False))


def run_case(case: dict[str, Any]) -> dict[str, Any]:
    catalog = load_seed_catalog()
    req = case["request"]
    menu = generate_menu(req, catalog)["menu"]
    state = case.get("shopping_state") or empty_shopping_state()
    pantry = req.get("pantry") or []
    prices = req.get("prices")
    shopping = compute_shopping(menu, catalog, pantry, prices, state)
    report = menu_report(menu, catalog, req["members"])
    ops: list[dict[str, Any]] = []
    current = menu
    ctx = {"catalog": catalog, "members": req["members"], "pantry": pantry, "prices": prices}
    for raw in case["ops"]:
        op = dict(raw)
        if "item_id" in op:
            op["item_id"] = resolve_item(current, op["item_id"])
        try:
            current = apply_menu_op(current, op, ctx)
            ops.append(
                {"op": op["op"], "menu": comparable_menu(current), "shopping_totals": compute_shopping(current, catalog, pantry, prices, state)["totals"]}
            )
        except EngineError as error:
            ops.append({"op": op["op"], "error": error.code})
    return {"menu": comparable_menu(menu), "shopping": shopping, "report": report, "ops": ops}


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_engine_parity(case: dict[str, Any]) -> None:
    expected = json.loads((FIXTURES / "expected" / f"{case['id']}.json").read_text(encoding="utf-8"))
    result = normalise(run_case(case))
    for key in ("menu", "shopping", "report", "ops"):
        assert result[key] == expected[key], key


def test_primitives_parity() -> None:
    catalog = load_seed_catalog()
    rng = Rng(20261016)
    sequence = [rng.next() for _ in range(20)]
    nutrition = [
        {"id": rid, "one": recipe_nutrition(catalog, catalog.recipes[rid], 1), "two": recipe_nutrition(catalog, catalog.recipes[rid], 2)}
        for rid in ["ovsyanka-s-yablokom", "pirog-s-kapustoy", "oladi-na-kefire", "borshch-s-govyadinoy"]
    ]
    expected = json.loads((FIXTURES / "expected" / "primitives.json").read_text(encoding="utf-8"))
    assert normalise({"sequence": sequence, "nutrition": nutrition}) == expected
