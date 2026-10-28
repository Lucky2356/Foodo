"""USDA values in the catalog without network: what replaces an estimate and what comes back."""

from __future__ import annotations

import csv
import io
import zipfile
from typing import Any

from scripts.catalog import build
from scripts.nutrition import usda

ESTIMATE = {k: 1.0 for k in build.NUTRIENTS}


def product(pid: str, source: str = build.PRODUCT_SOURCE) -> dict[str, Any]:
    return {"id": pid, "source": source, "nutrients": dict(ESTIMATE)}


def test_usda_values_replace_the_estimate_and_missing_nutrients_stay_unknown(
    tmp_path, monkeypatch
):
    values = tmp_path / "usda_values.json"
    values.write_text(
        '{"products": {"rice": {"fdc_id": 1, "per_100g": {"kcal": 360.0, "fat": 0.6}}}}',
        encoding="utf-8",
    )
    monkeypatch.setattr(build, "USDA_VALUES", values)
    products = {"rice": product("rice"), "kefir": product("kefir")}
    estimates: dict[str, Any] = {}
    assert build.apply_usda(products, set(), estimates) == []
    rice = products["rice"]
    assert rice["source"] == build.USDA_SOURCE
    assert rice["nutrients"]["kcal"] == 360 and rice["nutrients"]["fat"] == 0.6
    # Not reported by the dataset: unknown, neither zero nor the old estimate.
    assert rice["nutrients"]["vit_d"] is None and rice["nutrients"]["protein"] is None
    assert products["kefir"]["nutrients"] == ESTIMATE
    assert estimates == {"rice": ESTIMATE}


def test_a_removed_mapping_brings_the_saved_estimate_back(tmp_path, monkeypatch):
    values = tmp_path / "usda_values.json"
    values.write_text('{"products": {}}', encoding="utf-8")
    monkeypatch.setattr(build, "USDA_VALUES", values)
    rice = product("rice", build.USDA_SOURCE)
    rice["nutrients"] = {"kcal": 360}
    estimates: dict[str, Any] = {"rice": dict(ESTIMATE)}
    assert build.apply_usda({"rice": rice}, set(), estimates) == []
    assert rice["source"] == build.PRODUCT_SOURCE and rice["nutrients"] == ESTIMATE
    assert estimates == {}
    lost = product("lost", build.USDA_SOURCE)
    assert build.apply_usda({"lost": lost}, set(), {}) == [
        "lost: USDA values removed and no estimate saved"
    ]


def _csv(rows: list[dict[str, str]]) -> str:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()


def test_dataset_values_keep_reported_nutrients_only():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(
            "sr/nutrient.csv",
            _csv(
                [
                    {"id": "1008", "nutrient_nbr": "208"},
                    {"id": "1162", "nutrient_nbr": "401"},
                    {"id": "1114", "nutrient_nbr": "328"},
                ]
            ),
        )
        z.writestr("sr/food.csv", _csv([{"fdc_id": "7", "description": "Apples, raw"}]))
        z.writestr(
            "sr/food_nutrient.csv",
            _csv(
                [
                    {"fdc_id": "7", "nutrient_id": "1008", "amount": "52"},
                    {"fdc_id": "7", "nutrient_id": "1162", "amount": "4.6"},
                    {"fdc_id": "8", "nutrient_id": "1008", "amount": "99"},
                ]
            ),
        )
    result = usda.values_for(zipfile.ZipFile(buf), "abc", {"apple": {"fdc_id": 7}})
    assert result["products"] == {
        "apple": {
            "fdc_id": 7,
            "description": "Apples, raw",
            "per_100g": {"kcal": 52.0, "vit_c": 4.6},
        }
    }
