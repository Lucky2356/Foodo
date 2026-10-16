"""Explicit transfer of guest (browser) data into an account household.

The browser sends its versioned export only when the user presses «Перенести»; nothing is sent
when the login screen opens. preview_guest_import() reports what will be added and the conflicts;
apply_guest_import() writes everything in one transaction with the chosen resolution:
  resolution = {"members": {guest_member_id: "add" | "merge:<existing_member_id>"},
                "menus": {guest_menu_id: "add" | "skip"}}
"""

from __future__ import annotations

import copy
import json
import secrets
from datetime import date
from typing import Any

from django.conf import settings
from django.db import transaction

from catalog.models import Product, Recipe
from catalog.services import engine_catalog, save_recipe, validation_reference
from catalog.validation import validate_recipes
from common.errors import ApiError
from engine import menu_violations
from engine.catalog import snapshot_catalog

from .models import Favorite, Habit, HabitMark, Household, Member, Menu, PantryItem, PriceEntry, WaterEntry
from .validation import member_json, validate_household_settings, validate_member

JSON = dict[str, Any]
FORMAT = "foodo-guest-export"
SUPPORTED_VERSIONS = (1,)


def _check(data: Any) -> JSON:
    if not isinstance(data, dict) or data.get("format") != FORMAT:
        raise ApiError("invalid_import", "Это не файл экспорта Foodo.", 400)
    if data.get("format_version") not in SUPPORTED_VERSIONS:
        raise ApiError("unsupported_version", "Версия файла экспорта не поддерживается. Обновите приложение.", 400)
    if len(json.dumps(data)) > settings.FOODO_IMPORT_MAX_BYTES:
        raise ApiError("too_large", "Файл слишком большой для переноса.", 413)
    for key in ("members", "menus", "pantry", "prices", "favorites", "custom_recipes", "water", "habits"):
        if not isinstance(data.get(key, []), list):
            raise ApiError("invalid_import", f"Раздел «{key}» повреждён.", 400)
    return data


def preview_guest_import(h: Household, data: Any) -> JSON:
    data = _check(data)
    existing = {m.name.strip().lower(): m for m in h.members.all()}
    members = []
    for gm in data.get("members", []):
        match = existing.get(str(gm.get("name", "")).strip().lower())
        members.append(
            {
                "guest_id": gm.get("id"),
                "name": gm.get("name"),
                "conflict": {"existing_id": match.id, "existing_name": match.name} if match else None,
                "default": f"merge:{match.id}" if match else "add",
            }
        )
    starts = {m.start_date.isoformat(): m for m in h.menus.all()}
    menus = []
    for gmenu in data.get("menus", []):
        doc = gmenu.get("menu") or {}
        clash = starts.get(str(doc.get("start_date")))
        menus.append(
            {
                "guest_id": gmenu.get("id"),
                "start_date": doc.get("start_date"),
                "days": doc.get("days"),
                "conflict": {"existing_id": str(clash.id)} if clash else None,
                "default": "add",
            }
        )
    return {
        "members": members,
        "menus": menus,
        "counts": {k: len(data.get(k, [])) for k in ("pantry", "prices", "favorites", "custom_recipes", "water", "habits")},
        "settings_will_change": bool(data.get("household", {}).get("settings")) and not h.settings,
    }


def _remap_menu(doc: JSON, member_map: dict[str, str], recipe_map: dict[str, str]) -> JSON:
    doc = copy.deepcopy(doc)
    doc["member_ids"] = list(dict.fromkeys(member_map.get(m, m) for m in doc.get("member_ids", [])))
    for meal in doc.get("meals", []):
        for item in meal.get("items", []):
            portions: dict[str, float] = {}
            for mid, value in item.get("portions", {}).items():
                target = member_map.get(mid, mid)
                portions[target] = portions.get(target, 0) + value
            item["portions"] = portions
        for u in doc.get("unfilled", []):
            u["member_ids"] = [member_map.get(m, m) for m in u.get("member_ids", [])]
    for b in doc.get("batches", []):
        b["recipe_id"] = recipe_map.get(b["recipe_id"], b["recipe_id"])
    snap = doc.get("snapshot", {}).get("recipes", {})
    for old, new in recipe_map.items():
        if old in snap:
            snap[new] = {**snap.pop(old), "id": new}
    return doc


@transaction.atomic
def apply_guest_import(h: Household, data: Any, resolution: JSON) -> JSON:
    data = _check(data)
    member_res = resolution.get("members", {}) if isinstance(resolution, dict) else {}
    menu_res = resolution.get("menus", {}) if isinstance(resolution, dict) else {}
    own_members = {m.id: m for m in h.members.all()}
    member_map: dict[str, str] = {}
    added = {"members": 0, "menus": 0, "pantry": 0, "prices": 0, "favorites": 0, "custom_recipes": 0, "water": 0, "habits": 0}

    for gm in data.get("members", []):
        gid = str(gm.get("id"))
        choice = str(member_res.get(gid, "add"))
        if choice.startswith("merge:") and choice[6:] in own_members:
            member_map[gid] = choice[6:]
            continue
        fields = validate_member(gm)
        m = Member.objects.create(household=h, **fields)
        member_map[gid] = m.id
        added["members"] += 1

    hh = data.get("household") or {}
    if hh.get("settings") and not h.settings:
        h.settings = validate_household_settings(hh["settings"])
        h.save(update_fields=["settings"])

    products = set(Product.objects.values_list("id", flat=True))
    recipe_map: dict[str, str] = {}
    custom = data.get("custom_recipes", [])
    errors = validate_recipes([{**r, "id": "u-check-" + str(i)} for i, r in enumerate(custom)], products, validation_reference())
    if errors:
        raise ApiError("validation_error", "Собственные рецепты в файле содержат ошибки.", 400, {"errors": errors[:20]})
    for r in custom:
        new_id = f"u-{str(h.id)[:8]}-{secrets.token_hex(4)}"
        recipe_map[str(r["id"])] = new_id
        save_recipe({**r, "id": new_id, "source": "user"}, owner_household_id=h.id)
        added["custom_recipes"] += 1

    catalog = engine_catalog(h.id)
    members_after = [member_json(m) for m in h.members.all()]
    for gmenu in data.get("menus", []):
        if menu_res.get(str(gmenu.get("id")), "add") == "skip":
            continue
        doc = _remap_menu(gmenu["menu"], member_map, recipe_map)
        violations = menu_violations(doc, snapshot_catalog(doc, catalog), members_after)
        if violations:
            raise ApiError("restriction_violation", f"Меню от {doc.get('start_date')} нарушает ограничения участников: {violations[0]}", 400)
        Menu.objects.create(
            household=h,
            title=str(gmenu.get("title", ""))[:120],
            start_date=date.fromisoformat(doc["start_date"]),
            days=doc["days"],
            revision=doc.get("revision", 1),
            data=doc,
            shopping_state=gmenu.get("shopping_state") or {},
        )
        added["menus"] += 1

    for p in data.get("pantry", []):
        if p.get("product_id") in products and isinstance(p.get("qty"), (int, float)) and p["qty"] > 0:
            PantryItem.objects.create(
                household=h,
                product_id=p["product_id"],
                qty=p["qty"],
                unit=p.get("unit", "g"),
                location=str(p.get("location") or "")[:60],
                expires=p.get("expires") or None,
            )
            added["pantry"] += 1
    for e in data.get("prices", []):
        if e.get("product_id") in products and isinstance(e.get("price_kop"), int) and e.get("kind", "manual") in ("manual", "receipt"):
            PriceEntry.objects.create(
                household=h,
                product_id=e["product_id"],
                price_kop=e["price_kop"],
                package_size=e["package_size"],
                package_unit=e["package_unit"],
                loose=bool(e.get("loose")),
                observed_on=e.get("date") or date.today(),
                source=str(e.get("source") or "вручную")[:120],
                kind=e.get("kind", "manual"),
            )
            added["prices"] += 1
    for rid in data.get("favorites", []):
        target = recipe_map.get(rid, rid)
        if Recipe.objects.filter(pk=target).exists():
            Favorite.objects.get_or_create(household=h, recipe_id=target)
            added["favorites"] += 1
    for w in data.get("water", []):
        mid = member_map.get(str(w.get("member_id")))
        if mid and isinstance(w.get("amount_ml"), int):
            WaterEntry.objects.create(household=h, member_id=mid, amount_ml=w["amount_ml"], local_date=w["local_date"])
            added["water"] += 1
    for hb in data.get("habits", []):
        mid = member_map.get(str(hb.get("member_id")))
        if mid and isinstance(hb.get("name"), str):
            habit = Habit.objects.create(household=h, member_id=mid, name=hb["name"][:80])
            for day in hb.get("marks", []):
                HabitMark.objects.get_or_create(habit=habit, local_date=day)
            added["habits"] += 1
    return {"added": added, "member_map": member_map}
