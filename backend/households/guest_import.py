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
from collections.abc import Callable
from datetime import date
from typing import Any

from django.conf import settings
from django.db import transaction
from django.db.models import Q

from catalog.models import Product, Recipe
from catalog.services import engine_catalog, save_recipe, validation_reference
from catalog.validation import validate_recipes
from common.errors import ApiError
from engine import menu_violations
from engine.catalog import snapshot_catalog
from engine.shopping import empty_shopping_state

from .models import Favorite, Habit, HabitMark, Household, Member, Menu, PantryItem, PriceEntry, WaterEntry
from .records import pantry_fields, parse_date, price_fields
from .services import merge_shopping_patch
from .validation import member_json, validate_household_settings, validate_member

JSON = dict[str, Any]
FORMAT = "foodo-guest-export"
SUPPORTED_VERSIONS = (1,)
MAX_MEMBERS = 20
MAX_PANTRY = 1000
MAX_PRICES = 5000


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
                # A menu with the same start is most likely this one transferred before: skip by default.
                "default": "skip" if clash else "add",
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

    new_members: list[tuple[str, JSON]] = []
    for i, gm in enumerate(data.get("members", [])):
        gid = str(gm.get("id")) if isinstance(gm, dict) else ""
        choice = str(member_res.get(gid, "add"))
        if choice.startswith("merge:") and choice[6:] in own_members:
            member_map[gid] = choice[6:]
            continue
        new_members.append((gid, _record("Участники", i, validate_member, gm)))
    if len(own_members) + len(new_members) > MAX_MEMBERS:
        raise ApiError("limit", f"В семье может быть не больше {MAX_MEMBERS} участников: объедините совпадающих или удалите лишних.", 400)
    for gid, fields in new_members:
        member_map[gid] = Member.objects.create(household=h, **fields).id
        added["members"] += 1

    hh = data.get("household") or {}
    if hh.get("settings") and not h.settings:
        h.settings = validate_household_settings(hh["settings"])
        h.save(update_fields=["settings"])

    products = set(Product.objects.values_list("id", flat=True))
    recipe_map: dict[str, str] = {}
    ref = validation_reference()
    custom = [_with_current_spice_rule(r, set(ref.get("hot_products", []))) for r in data.get("custom_recipes", [])]
    errors = validate_recipes([{**r, "id": "u-check-" + str(i)} for i, r in enumerate(custom)], products, ref)
    if errors:
        raise ApiError("validation_error", "Собственные рецепты в файле содержат ошибки.", 400, {"errors": errors[:20]})
    for r in custom:
        new_id = f"u-{str(h.id)[:8]}-{secrets.token_hex(4)}"
        recipe_map[str(r["id"])] = new_id
        save_recipe({**r, "id": new_id, "source": "user"}, owner_household_id=h.id)
        added["custom_recipes"] += 1

    catalog = engine_catalog(h.id)
    members_after = [member_json(m) for m in h.members.all()]
    for i, gmenu in enumerate(data.get("menus", [])):
        problem = _menu_problem(gmenu)
        if problem:
            raise ApiError("invalid_import", f"Меню, запись {i + 1}: {problem}.", 400)
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
            shopping_state=_record("Меню", i, _shopping_state, gmenu.get("shopping_state")),
        )
        added["menus"] += 1

    # Every record passes the checks of a manual entry; the transaction rolls everything back on the
    # first broken one, so the account never ends up half-filled.
    pantry = data.get("pantry", [])
    if h.pantry.count() + len(pantry) > MAX_PANTRY:
        raise ApiError("limit", "Слишком много записей остатков.", 400)
    for i, p in enumerate(pantry):
        PantryItem.objects.create(household=h, **_record("Остатки", i, pantry_fields, p))
        added["pantry"] += 1
    prices = data.get("prices", [])
    if h.prices.count() + len(prices) > MAX_PRICES:
        raise ApiError("limit", "Слишком много своих цен.", 400)
    for i, e in enumerate(prices):
        fields = _record("Цены", i, price_fields, e)
        PriceEntry.objects.create(household=h, **fields)
        added["prices"] += 1
    for rid in data.get("favorites", []):
        target = recipe_map.get(str(rid), str(rid))
        # Someone else's private recipe is not revealed, not even as «exists».
        if Recipe.objects.filter(pk=target).filter(Q(visibility="public") | Q(owner_household=h)).exists():
            Favorite.objects.get_or_create(household=h, recipe_id=target)
            added["favorites"] += 1
    for i, w in enumerate(data.get("water", [])):
        mid, amount, day = _record("Вода", i, _water, w)
        if mid in member_map:
            WaterEntry.objects.create(household=h, member_id=member_map[mid], amount_ml=amount, local_date=day)
            added["water"] += 1
    for i, hb in enumerate(data.get("habits", [])):
        mid, name, marks = _record("Привычки", i, _habit, hb)
        if mid in member_map:
            habit = Habit.objects.create(household=h, member_id=member_map[mid], name=name)
            for day in marks:
                HabitMark.objects.get_or_create(habit=habit, local_date=day)
            added["habits"] += 1
    return {"added": added, "member_map": member_map}


def _record[T](section: str, index: int, check: Callable[[Any], T], value: Any) -> T:
    """Runs a record check and names the broken record: «Остатки, запись 3: …»."""
    try:
        return check(value)
    except ApiError as e:
        raise ApiError("invalid_import", f"{section}, запись {index + 1}: {e.message}", 400) from e


def _menu_problem(gmenu: Any) -> str | None:
    if not isinstance(gmenu, dict) or not isinstance(gmenu.get("menu"), dict):
        return "нет данных меню"
    doc = gmenu["menu"]
    try:
        date.fromisoformat(str(doc.get("start_date")))
    except ValueError:
        return "неверная дата начала"
    days = doc.get("days")
    if not isinstance(days, int) or isinstance(days, bool) or not 1 <= days <= 35:
        return "период — от 1 до 35 дней"
    revision = doc.get("revision", 1)
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
        return "неверная версия меню"
    for key in ("meals", "batches", "slots", "member_ids"):
        if not isinstance(doc.get(key), list):
            return f"раздел «{key}» повреждён"
    if not isinstance(doc.get("snapshot"), dict) or not isinstance(doc.get("settings"), dict):
        return "настройки или снимок рецептов повреждены"
    batches = {b.get("id") for b in doc["batches"] if isinstance(b, dict)}
    if not all(isinstance(b, dict) and isinstance(b.get("recipe_id"), str) for b in doc["batches"]):
        return "партия повреждена"
    for meal in doc["meals"]:
        if not isinstance(meal, dict) or not isinstance(meal.get("items"), list):
            return "приём пищи повреждён"
        for item in meal["items"]:
            if not isinstance(item, dict) or not isinstance(item.get("portions"), dict) or item.get("batch_id") not in batches:
                return "блюдо ссылается на несуществующую партию"
    return None


def _shopping_state(value: Any) -> JSON:
    if value is None:
        return empty_shopping_state()
    if not isinstance(value, dict):
        raise ApiError("validation_error", "состояние списка покупок повреждено")
    return merge_shopping_patch(empty_shopping_state(), value)


def _water(w: Any) -> tuple[str, int, date]:
    if not isinstance(w, dict):
        raise ApiError("validation_error", "запись повреждена")
    amount = w.get("amount_ml")
    if not isinstance(amount, int) or isinstance(amount, bool) or not 1 <= amount <= 10_000:
        raise ApiError("validation_error", "объём — от 1 до 10 000 мл")
    return str(w.get("member_id")), amount, parse_date(w.get("local_date"), "local_date")


def _habit(hb: Any) -> tuple[str, str, list[date]]:
    if not isinstance(hb, dict):
        raise ApiError("validation_error", "запись повреждена")
    name = hb.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 80:
        raise ApiError("validation_error", "название — от 1 до 80 символов")
    marks = hb.get("marks", [])
    if not isinstance(marks, list) or len(marks) > 5000:
        raise ApiError("validation_error", "отметки повреждены")
    return str(hb.get("member_id")), name.strip(), [parse_date(d, "marks") for d in marks]


def _with_current_spice_rule(recipe: Any, hot: set[str]) -> Any:
    """Recipes saved before the spice rule (docs/NUTRITION_RULES.md) are brought up to it instead of
    blocking the transfer: a hot ingredient makes the dish at least slightly spicy, and a spicy dish
    is not marked as one for children."""
    if not isinstance(recipe, dict) or not isinstance(recipe.get("ingredients"), list):
        return recipe
    out = dict(recipe)
    if out.get("spicy", 0) == 0 and any(isinstance(i, dict) and i.get("product") in hot for i in out["ingredients"]):
        out["spicy"] = 1
    if isinstance(out.get("spicy"), int) and out["spicy"] > 0:
        out["kid_friendly"] = False
    return out
