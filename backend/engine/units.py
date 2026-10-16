"""Unit conversions; twin of frontend/src/engine/units.ts.

g↔kg and ml↔l are universal; mass↔volume needs density, pieces need the average piece mass,
spoons and pinches need product-specific masses. Without a coefficient the result is None.
"""

from __future__ import annotations

from typing import Any

Product = dict[str, Any]


def to_grams(product: Product, qty: float, unit: str) -> float | None:
    if unit == "g":
        return qty
    if unit == "kg":
        return qty * 1000
    density = product.get("density_g_ml")
    if unit == "ml":
        return qty * density if density else None
    if unit == "l":
        return qty * 1000 * density if density else None
    if unit == "pcs":
        piece = product.get("piece_g")
        return qty * piece if piece else None
    if unit in ("tbsp", "tsp", "pinch"):
        spoon = (product.get("spoon_g") or {}).get(unit)
        return qty * spoon if spoon else None
    return None


def edible_grams(product: Product, qty: float, unit: str) -> float | None:
    gross = to_grams(product, qty, unit)
    return None if gross is None else gross * product["edible_fraction"]


def to_base(product: Product, qty: float, unit: str) -> float | None:
    base = product["base_unit"]
    density = product.get("density_g_ml")
    if base == "ml":
        if unit == "ml":
            return qty
        if unit == "l":
            return qty * 1000
        grams = to_grams(product, qty, unit)
        if grams is None or not density:
            return None
        return grams / density
    if base == "pcs":
        if unit == "pcs":
            return qty
        grams = to_grams(product, qty, unit)
        piece = product.get("piece_g")
        if grams is None or not piece:
            return None
        return grams / piece
    return to_grams(product, qty, unit)
