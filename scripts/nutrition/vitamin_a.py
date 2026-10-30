"""Vitamin A in retinol equivalents (RE), the form of the МР 2.3.1.0253-21 targets.

Appendix 2 of МР 2.3.1.0253-21 defines both forms:
  1 µg RAE = 1 µg retinol = 12 µg β-carotene = 24 µg other provitamin A carotenoids;
  1 µg RE  = 1 µg retinol =  6 µg β-carotene = 12 µg other provitamin A carotenoids.
The provitamin A carotenoids reported by USDA SR Legacy are β-carotene, α-carotene and
β-cryptoxanthin, and its RAE (nutrient 320) is computed from them with the first definition.

So RE is exact from the components and follows from the published RAE by algebra, without any
assumption about the food:
  RE = retinol + β-carotene / 6 + (α-carotene + β-cryptoxanthin) / 12;
  RE = 2 · RAE − retinol                                  (RAE and retinol known);
  RE = RAE + β-carotene / 12 + (α-carotene + β-cryptoxanthin) / 24  (RAE and carotenoids known).
Anything less leaves vitamin A unknown.
"""

from __future__ import annotations

from collections.abc import Mapping

OTHER_CAROTENOIDS = ("alpha_carotene", "beta_cryptoxanthin")


def retinol_equivalents(values: Mapping[str, float]) -> float | None:
    """µg RE per 100 g from USDA values (`vit_a` there is µg RAE as published), or None."""
    retinol = values.get("retinol")
    rae = values.get("vit_a")
    carotenoids = [values.get(k) for k in ("beta_carotene", *OTHER_CAROTENOIDS)]
    beta: float | None = None
    other: float | None = None
    if all(v is not None for v in carotenoids):
        beta = values["beta_carotene"]
        other = sum(values[k] for k in OTHER_CAROTENOIDS)
    if retinol is not None and beta is not None and other is not None:
        re = retinol + beta / 6 + other / 12
    elif rae is not None and retinol is not None:
        re = 2 * rae - retinol
    elif rae is not None and beta is not None and other is not None:
        re = rae + beta / 12 + other / 24
    else:
        return None
    # Rounding in the published values can push a derived zero slightly below it.
    return round(max(re, 0.0), 1)
