"""Validation of single household records (pantry, own prices, dates) shared by the API views and
the guest-data transfer, so an imported file passes exactly the checks of a manual entry."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from catalog.models import Product
from catalog.services import product_to_json
from common.errors import ApiError
from engine.units import to_base
from geo.models import StoreChain

JSON = dict[str, Any]


def parse_date(value: Any, field: str) -> date:
    try:
        return date.fromisoformat(str(value))
    except ValueError as e:
        raise ApiError("validation_error", f"Некорректная дата в поле «{field}».", 400, {"field": field}) from e


def recent_day(value: Any, today: date) -> date:
    """A day for water and habit marks: within the last year and not after tomorrow, so the number of
    records stays bounded and a typo in the year does not land in 2099."""
    day = parse_date(value, "local_date")
    if not today - timedelta(days=366) <= day <= today + timedelta(days=1):
        raise ApiError("validation_error", "Дата — в пределах последнего года.", 400, {"field": "local_date"})
    return day


def pantry_fields(data: Any) -> JSON:
    if not isinstance(data, dict):
        raise ApiError("validation_error", "Запись остатков — объект с продуктом и количеством.")
    product = Product.objects.filter(pk=data.get("product_id")).first()
    if product is None:
        raise ApiError("unknown_product", "Неизвестный продукт.")
    qty = data.get("qty")
    if not isinstance(qty, (int, float)) or isinstance(qty, bool) or not 0 < qty <= 1_000_000:
        raise ApiError("validation_error", "Количество — положительное число.")
    unit = data.get("unit") or product.base_unit
    if unit != product.base_unit:
        raise ApiError("validation_error", f"Для «{product.name}» количество указывается в единице «{product.base_unit}».")
    expires = parse_date(data["expires"], "expires") if data.get("expires") else None
    return {"product": product, "qty": float(qty), "unit": unit, "location": str(data.get("location") or "")[:60], "expires": expires}


def price_fields(data: Any) -> JSON:
    if not isinstance(data, dict):
        raise ApiError("validation_error", "Цена — объект с полями продукта и упаковки.")
    product = Product.objects.filter(pk=data.get("product_id")).first()
    if product is None:
        raise ApiError("unknown_product", "Неизвестный продукт.")
    price = data.get("price_kop")
    size = data.get("package_size")
    if not isinstance(price, int) or isinstance(price, bool) or not 0 < price <= 10_000_000:
        raise ApiError("validation_error", "Цена в копейках — положительное целое число.")
    if not isinstance(size, (int, float)) or isinstance(size, bool) or not 0 < size <= 100_000:
        raise ApiError("validation_error", "Размер упаковки — положительное число.")
    if data.get("package_unit") not in ("g", "kg", "ml", "l", "pcs"):
        raise ApiError("validation_error", "Единица упаковки: g, kg, ml, l или pcs.")
    # A price in a unit the product cannot be converted to would never apply to the list.
    if to_base(product_to_json(product), float(size), data["package_unit"]) is None:
        raise ApiError("incompatible_unit", f"Для «{product.name}» нельзя указать цену в этой единице: нет пересчёта.")
    chain_id = data.get("chain_id")
    if chain_id and not StoreChain.objects.filter(pk=chain_id).exists():
        raise ApiError("validation_error", "Неизвестная сеть.")
    kind = data.get("kind", "manual")
    if kind not in ("manual", "receipt"):
        raise ApiError("validation_error", "Вид цены: manual или receipt.")
    return {
        "product_id": data["product_id"],
        "price_kop": price,
        "package_size": float(size),
        "package_unit": data["package_unit"],
        "loose": bool(data.get("loose", False)),
        "observed_on": parse_date(data.get("date") or date.today().isoformat(), "date"),
        "source": str(data.get("source") or "вручную")[:120],
        "kind": kind,
        "chain_id": chain_id or None,
        "available": data.get("available") if isinstance(data.get("available"), bool) else None,
    }
