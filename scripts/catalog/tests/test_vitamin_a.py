"""Vitamin A in retinol equivalents by МР 2.3.1.0253-21, appendix 2."""

from __future__ import annotations

from typing import Any

from scripts.catalog import build
from scripts.nutrition.vitamin_a import retinol_equivalents


def test_components_give_re_with_the_document_coefficients():
    # 1 µg RE = 1 µg retinol = 6 µg β-carotene = 12 µg other provitamin A carotenoids.
    values = {
        "retinol": 10.0,
        "beta_carotene": 60.0,
        "alpha_carotene": 24.0,
        "beta_cryptoxanthin": 12.0,
    }
    assert retinol_equivalents(values) == 10 + 10 + 3


def test_published_rae_converts_exactly_when_retinol_is_known():
    # RAE = retinol + β-carotene/12 + others/24, so RE = 2 · RAE − retinol.
    assert retinol_equivalents({"vit_a": 835.0, "retinol": 0.0}) == 1670
    assert retinol_equivalents({"vit_a": 160.0, "retinol": 160.0}) == 160


def test_rae_alone_is_not_enough():
    assert retinol_equivalents({"vit_a": 100.0}) is None
    assert retinol_equivalents({"retinol": 5.0}) is None
    assert retinol_equivalents({"beta_carotene": 60.0, "vit_a": 5.0}) is None


def test_estimates_keep_only_a_zero():
    def product(vit_a: Any) -> dict[str, Any]:
        return {
            "source": build.PRODUCT_SOURCE,
            "nutrients": {k: 1 for k in build.NUTRIENTS} | {"vit_a": vit_a},
        }

    products = {"salt": product(0), "kefir": product(22), "tea": product(None)}
    usda = {"source": build.USDA_SOURCE, "nutrients": {"vit_a": 50}}
    products["carrot"] = usda
    build.estimates_in_retinol_equivalents(products)
    assert [products[k]["nutrients"]["vit_a"] for k in ("salt", "kefir", "tea")] == [
        0,
        None,
        None,
    ]
    assert products["carrot"]["nutrients"]["vit_a"] == 50
