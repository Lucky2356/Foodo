"""Household workflows built on the engine: plan requests, menus, shopping, cooking, pantry."""

from __future__ import annotations

import secrets
from datetime import date, datetime
from typing import Any

from django.db import IntegrityError, transaction
from django.utils import timezone

from catalog.services import engine_catalog
from common.errors import ApiError
from engine import apply_menu_op, compute_shopping, empty_shopping_state, generate_menu, menu_report, pantry_after_cooking
from engine.catalog import Catalog
from prices.services import merge_price_sources, public_prices

from .models import CookConfirmation, Household, Member, Menu, PantryItem, PriceEntry, PurchaseTransfer
from .validation import member_json, validate_household_settings, zone

JSON = dict[str, Any]


def household_settings(h: Household) -> JSON:
    return validate_household_settings(h.settings or {})


def members_json(h: Household) -> list[JSON]:
    return [member_json(m) for m in h.members.all()]


def pantry_json(h: Household) -> list[JSON]:
    return [
        {
            "id": p.id,
            "product_id": p.product_id,
            "qty": p.qty,
            "unit": p.unit,
            "location": p.location or None,
            "expires": p.expires.isoformat() if p.expires else None,
        }
        for p in h.pantry.all().order_by("created_at", "id")
    ]


def own_price_entries(h: Household) -> list[JSON]:
    return [
        {
            "id": e.id,
            "product_id": e.product_id,
            "price_kop": e.price_kop,
            "package_size": e.package_size,
            "package_unit": e.package_unit,
            "currency": e.currency,
            "date": e.observed_on.isoformat(),
            "source": e.source,
            "kind": e.kind,
            "loose": e.loose,
            "available": e.available,
            "chain_id": e.chain_id,
        }
        for e in h.prices.all()
    ]


def price_profile(h: Household) -> JSON:
    own = [e for e in own_price_entries(h) if e["chain_id"] in (None, h.store_chain_id)]
    public = public_prices(h.city, h.store_chain) if h.city_id else []
    return {
        "store_id": h.store_chain_id or "none",
        "city_id": h.city_id,
        "region": h.city.region if h.city_id else None,
        "entries": merge_price_sources(own, public),
    }


def build_plan_request(h: Household, start_date: str, days: int | None, seed: int | None, slots: list[str] | None = None) -> JSON:
    cfg = household_settings(h)
    members = members_json(h)
    if not members:
        raise ApiError("no_members", "Добавьте хотя бы одного участника семьи.", 400)
    return {
        "start_date": start_date,
        "days": days or cfg["days"],
        "seed": seed if seed is not None else secrets.randbelow(4294967296),
        "slots": slots or cfg["slots"],
        "members": members,
        "slot_members": cfg["slot_members"],
        "settings": cfg["plan"],
        "pins": [],
        "pantry": pantry_json(h),
        "prices": price_profile(h),
    }


def menu_summary(m: Menu) -> JSON:
    return {
        "id": str(m.id),
        "title": m.title,
        "start_date": m.start_date.isoformat(),
        "days": m.days,
        "revision": m.revision,
        "is_favorite": m.is_favorite,
        "created_at": m.created_at.isoformat(),
        "updated_at": m.updated_at.isoformat(),
    }


def menu_json(m: Menu) -> JSON:
    return {
        **menu_summary(m),
        "menu": m.data,
        "shopping_revision": m.shopping_revision,
        "cooked_batches": list(m.cook_confirmations.values_list("batch_id", flat=True)),
    }


@transaction.atomic
def create_menu(h: Household, req: JSON, title: str = "") -> Menu:
    catalog = engine_catalog(h.id)
    result = generate_menu(req, catalog)
    menu = result["menu"]
    return Menu.objects.create(
        household=h,
        title=title[:120],
        start_date=date.fromisoformat(menu["start_date"]),
        days=menu["days"],
        revision=menu["revision"],
        data=menu,
        shopping_state=empty_shopping_state(),
    )


def op_context(h: Household, catalog: Catalog) -> JSON:
    cfg = household_settings(h)
    return {
        "catalog": catalog,
        "members": members_json(h),
        "pantry": pantry_json(h),
        "prices": price_profile(h),
        "settings": cfg["plan"],
        "slot_members": cfg["slot_members"],
    }


@transaction.atomic
def apply_op(h: Household, menu_id: Any, op: JSON, expected_revision: int | None) -> Menu:
    menu = Menu.objects.select_for_update().get(pk=menu_id, household=h)
    if expected_revision is not None and expected_revision != menu.revision:
        raise ApiError("revision_conflict", "Меню изменилось на другом устройстве. Обновите страницу и повторите действие.", 409, {"revision": menu.revision})
    catalog = engine_catalog(h.id)
    updated = apply_menu_op(menu.data, op, op_context(h, catalog))
    menu.data = updated
    menu.revision = updated["revision"]
    menu.save(update_fields=["data", "revision", "updated_at"])
    return menu


def shopping_for(h: Household, menu: Menu) -> JSON:
    catalog = engine_catalog(h.id)
    state = {**empty_shopping_state(), **(menu.shopping_state or {})}
    transfers = list(menu.purchase_transfers.values_list("line_id", "qty"))
    # What this menu bought and moved to the pantry is not «already at home» for its own list.
    bought: dict[str, float] = {}
    for line_id, qty in transfers:
        product_id = line_id.split(":")[1] if line_id.startswith("auto:") else None
        if product_id:
            bought[product_id] = bought.get(product_id, 0) + qty
    result = compute_shopping(menu.data, catalog, pantry_json(h), price_profile(h), state, household_settings(h)["plan"]["budget"], bought)
    transferred = {line_id for line_id, _ in transfers}
    for line in result["lines"]:
        line["transferred"] = line["id"] in transferred
    return {**result, "state": state, "shopping_revision": menu.shopping_revision}


def report_for(h: Household, menu: Menu) -> list[JSON]:
    return menu_report(menu.data, engine_catalog(h.id), members_json(h))


@transaction.atomic
def update_shopping_state(h: Household, menu_id: Any, patch: JSON, expected_revision: int | None) -> Menu:
    menu = Menu.objects.select_for_update().get(pk=menu_id, household=h)
    if expected_revision is not None and expected_revision != menu.shopping_revision:
        raise ApiError("revision_conflict", "Список покупок изменился на другом устройстве. Обновите страницу.", 409, {"revision": menu.shopping_revision})
    state = {**empty_shopping_state(), **(menu.shopping_state or {})}
    if "marks" in patch:
        marks = patch["marks"]
        if not isinstance(marks, dict) or len(marks) > 2000:
            raise ApiError("validation_error", "Некорректные отметки.")
        for line_id, mark in marks.items():
            if mark is None:
                state["marks"].pop(line_id, None)
            elif isinstance(mark, dict):
                state["marks"][str(line_id)[:120]] = {k: bool(v) for k, v in mark.items() if k in ("purchased", "at_home")}
    if "manual_lines" in patch:
        lines = patch["manual_lines"]
        if not isinstance(lines, list) or len(lines) > 300:
            raise ApiError("validation_error", "Слишком много ручных строк.")
        clean = []
        for ln in lines:
            if (
                not isinstance(ln, dict)
                or not isinstance(ln.get("name"), str)
                or not ln["name"].strip()
                or not str(ln.get("id", "")).startswith(("manual:", "manual-"))
            ):
                raise ApiError("validation_error", "Ручная строка: id «manual:…» и название обязательны.")
            price = ln.get("price_kop")
            qty = ln.get("qty")
            if qty is not None and (not isinstance(qty, (int, float)) or isinstance(qty, bool) or not 0 < qty <= 100000):
                raise ApiError("validation_error", "Ручная строка: количество — число больше нуля или пусто.")
            if price is not None and (not isinstance(price, int) or isinstance(price, bool) or not 0 <= price <= 100_000_000):
                raise ApiError("validation_error", "Ручная строка: цена — сумма в копейках, 0 или больше, или пусто.")
            clean.append(
                {
                    "id": str(ln["id"])[:80],
                    "name": ln["name"].strip()[:120],
                    "qty": qty,
                    "unit": str(ln.get("unit") or "")[:10] or None,
                    "department": str(ln.get("department") or "Другое")[:60],
                    "price_kop": price,
                }
            )
        state["manual_lines"] = clean
    if "seen" in patch:
        seen = patch["seen"]
        if isinstance(seen, dict):
            state["seen"] = {str(k)[:120]: float(v) for k, v in list(seen.items())[:2000] if isinstance(v, (int, float))}
    menu.shopping_state = state
    menu.shopping_revision += 1
    menu.save(update_fields=["shopping_state", "shopping_revision", "updated_at"])
    return menu


@transaction.atomic
def confirm_cooking(h: Household, menu_id: Any, batch_id: str) -> tuple[CookConfirmation, bool]:
    """Deducts the batch's ingredients from the pantry exactly once (idempotent under retries and
    concurrent requests: the menu row is locked and (menu, batch) is unique)."""
    menu = Menu.objects.select_for_update().get(pk=menu_id, household=h)
    existing = CookConfirmation.objects.filter(menu=menu, batch_id=batch_id).first()
    if existing is not None:
        return existing, False
    if not any(b["id"] == batch_id for b in menu.data["batches"]):
        raise ApiError("batch_not_found", "Партия не найдена в меню.", 404)
    items = list(PantryItem.objects.select_for_update().filter(household=h).order_by("created_at", "id"))
    pantry = [
        {
            "id": p.id,
            "product_id": p.product_id,
            "qty": p.qty,
            "unit": p.unit,
            "location": p.location or None,
            "expires": p.expires.isoformat() if p.expires else None,
        }
        for p in items
    ]
    new_pantry, allocations = pantry_after_cooking(menu.data, engine_catalog(h.id), pantry, batch_id)
    left = {p["id"]: p for p in new_pantry}
    for item in items:
        if item.id not in left:
            item.delete()
        elif left[item.id]["qty"] != item.qty or left[item.id]["unit"] != item.unit:
            item.qty = left[item.id]["qty"]
            item.unit = left[item.id]["unit"]
            item.save(update_fields=["qty", "unit", "updated_at"])
    try:
        with transaction.atomic():
            confirmation = CookConfirmation.objects.create(menu=menu, batch_id=batch_id, allocations=allocations)
    except IntegrityError as e:  # pragma: no cover - guarded by the row lock above
        raise ApiError("already_confirmed", "Блюдо уже отмечено приготовленным.", 409) from e
    return confirmation, True


@transaction.atomic
def transfer_purchases(h: Household, menu_id: Any, line_ids: list[str]) -> JSON:
    """Adds purchased quantities (whole packages) to the pantry once per shopping line."""
    menu = Menu.objects.select_for_update().get(pk=menu_id, household=h)
    shopping = shopping_for(h, menu)
    by_id = {ln["id"]: ln for ln in shopping["lines"]}
    done = set(menu.purchase_transfers.values_list("line_id", flat=True))
    added, skipped = [], []
    for line_id in line_ids:
        line = by_id.get(line_id)
        if line is None or line_id in done or not line["convertible"] or line["buy_qty"] <= 0:
            skipped.append(line_id)
            continue
        # Whole packages go to the pantry: the leftover after cooking stays at home.
        PurchaseTransfer.objects.create(menu=menu, line_id=line_id, qty=line["buy_qty"])
        PantryItem.objects.create(household=h, product_id=line["product_id"], qty=line["buy_qty"], unit=line["unit"], location="Куплено")
        added.append(line_id)
        done.add(line_id)
    return {"added": added, "skipped": skipped}


def local_today(member: Member, now: datetime | None = None) -> date:
    return (now or timezone.now()).astimezone(zone(member.timezone)).date()


def price_entry_json(e: PriceEntry) -> JSON:
    return {
        "id": e.id,
        "product_id": e.product_id,
        "chain_id": e.chain_id,
        "price_kop": e.price_kop,
        "package_size": e.package_size,
        "package_unit": e.package_unit,
        "loose": e.loose,
        "currency": e.currency,
        "date": e.observed_on.isoformat(),
        "source": e.source,
        "kind": e.kind,
        "available": e.available,
    }
