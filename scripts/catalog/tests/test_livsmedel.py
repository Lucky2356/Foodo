"""Livsmedelsdatabasen values in Foodo's forms: what is taken, what stays unknown."""

from __future__ import annotations

from typing import Any

import pytest

from scripts.nutrition.livsmedel import catalog_nutrients


def row(value: float, unit: str, kind: str = "BE") -> dict[str, Any]:
    return {"value": value, "unit": unit, "type": kind}


BASE = {
    "ENERC": row(60, "kcal"),
    "PROT": row(3.4, "g"),
    "FAT": row(3.0, "g"),
    "WATER": row(88.0, "g"),
    "ASH": row(0.7, "g"),
    "ALC": row(0.0, "g", "LZ"),
    "FIBT": row(0.0, "g", "LZ"),
    "RETOL": row(25.0, "µg"),
    "CARTBTOT": row(14, "µg"),
    "VITA": row(26.2, "RE/µg"),
    "VITD": row(1.0, "µg"),
    "VITE": row(0.1, "mg"),
    "VITC": row(0.0, "mg", "LZ"),
    "VITB6": row(0.04, "mg"),
    "VITB12": row(0.27, "µg"),
    "FOL": row(11.2, "µg"),
}


def test_carbohydrates_by_difference_and_vitamin_d_not_taken():
    n = catalog_nutrients(BASE, fortified=False)
    # 100 − water − protein − fat − ash − alcohol, Foodo's definition of carbohydrates.
    assert n["carbs"] == 4.9
    assert n["kcal"] == 60 and n["vit_e"] == 0.1 and n["folate"] == 11.2
    # D2 + D3 + 25-OH-D3 × 2.5 there, D2 + D3 in Foodo: a different form stays unknown.
    assert n["vit_d"] is None


def test_vitamin_a_only_where_the_food_has_no_carotenoids():
    # RAE from retinol and beta-carotene is not the RE of the norms while other carotenoids are unknown.
    assert catalog_nutrients(BASE, fortified=False)["vit_a"] is None
    fish = BASE | {"CARTBTOT": row(0, "µg", "LZ"), "RETOL": row(79.0, "µg")}
    assert catalog_nutrients(fish, fortified=False)["vit_a"] == 79.0
    # Swedish fortified milk products: vitamins A and D added, ours are not.
    assert catalog_nutrients(fish, fortified=True)["vit_a"] is None


def test_an_unexpected_unit_stops_the_build():
    with pytest.raises(ValueError):
        catalog_nutrients(BASE | {"VITE": row(100, "µg")}, fortified=False)
