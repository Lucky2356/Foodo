"""Editing operations on a saved menu; twin of frontend/src/engine/menuOps.ts."""

from __future__ import annotations

import copy
from typing import Any

from .basics import is_iso_date
from .catalog import Catalog, add_to_snapshot, find_method, recipe_skill_rank, select_method, skill_allows, snapshot_catalog
from .errors import EngineError
from .generator import generate_menu, member_portions, menu_violations, rank_candidates
from .restrictions import effective_restrictions, recipe_spice, recipe_violations, spice_tolerance

JSON = dict[str, Any]


def _next_id(prefix: str, ids: list[str]) -> str:
    highest = 0
    for i in ids:
        if i.startswith(prefix) and i[len(prefix) :].isdigit():
            highest = max(highest, int(i[len(prefix) :]))
    return f"{prefix}{highest + 1}"


def _all_items(menu: JSON) -> list[tuple[JSON, JSON]]:
    return [(meal, item) for meal in menu["meals"] for item in meal["items"]]


def _find_item(menu: JSON, item_id: str) -> tuple[JSON, JSON]:
    for meal, item in _all_items(menu):
        if item["id"] == item_id:
            return meal, item
    raise EngineError("item_not_found", "Блюдо не найдено в меню.")


def _find_meal(menu: JSON, date: str, slot: str) -> JSON:
    for meal in menu["meals"]:
        if meal["date"] == date and meal["slot"] == slot:
            return meal
    raise EngineError("meal_not_found", "Приём пищи не найден в меню.")


def _batch_of(menu: JSON, item: JSON) -> JSON:
    for b in menu["batches"]:
        if b["id"] == item["batch_id"]:
            return b
    raise EngineError("batch_not_found", "Партия блюда не найдена.")


def _item_total(item: JSON) -> float:
    total: float = 0
    for key in sorted(item["portions"].keys()):
        total += item["portions"][key]
    return total


def _normalise_batches(menu: JSON) -> None:
    totals: dict[str, float] = {}
    for _, item in _all_items(menu):
        totals[item["batch_id"]] = totals.get(item["batch_id"], 0) + _item_total(item)
    menu["batches"] = [b for b in menu["batches"] if totals.get(b["id"], 0) > 0]
    for b in menu["batches"]:
        b["portions"] = totals.get(b["id"], 0)


def _check_manual_choice(
    menu: JSON, catalog: Catalog, recipe_id: str, method_id: str | None, people: list[JSON], slot: str, keep_batch: str | None = None
) -> JSON:
    """Twin of checkManualChoice in menuOps.ts: restrictions, spice, equipment, skill, meal and unique mode."""
    recipe = catalog.recipes.get(recipe_id)
    if recipe is None:
        raise EngineError("recipe_not_found", "Рецепт не найден.")
    for m in people:
        if recipe_spice(recipe) > spice_tolerance(m):
            raise EngineError("too_spicy", f"«{recipe['name']}» острее, чем допускает участник «{m['name']}».", {"member_id": m["id"]})
        v = recipe_violations(catalog, recipe, effective_restrictions(catalog, m))
        if v:
            raise EngineError(
                "restriction_violation",
                f"«{recipe['name']}» нельзя участнику «{m['name']}»: блюдо нарушает его запреты или его состав не проверен.",
                {"member_id": m["id"], "violations": v},
            )
    # Hard restrictions come first; then the meal and the repeat mode.
    if slot not in recipe["meal_types"]:
        name = next((s["name"].lower() for s in catalog.reference["meal_slots"] if s["id"] == slot), slot)
        raise EngineError("wrong_meal_type", f"«{recipe['name']}» не подходит на {name}.")
    if menu["settings"]["repeat"]["mode"] == "unique" and any(b["recipe_id"] == recipe_id and b["id"] != keep_batch for b in menu["batches"]):
        raise EngineError("repeat_conflict", f"«{recipe['name']}» уже есть в меню, а выбран режим «Разные блюда каждый день».")
    equipment = menu["settings"]["equipment"]
    method = find_method(recipe, method_id) if method_id else select_method(recipe, equipment)
    if method is None or not all(e in equipment for e in method["equipment"]):
        raise EngineError("equipment_missing", f"Для «{recipe['name']}» нужна техника, которой нет в настройках кухни.")
    if not skill_allows(menu["settings"]["skill"], recipe_skill_rank(catalog.reference, recipe)):
        raise EngineError("skill_too_high", f"«{recipe['name']}» требует более высокого уровня готовки, чем выбран в настройках.")
    return method


def _new_batch_for(menu: JSON, catalog: Catalog, recipe_id: str, method_id: str, date: str, slot: str) -> JSON:
    recipe = catalog.recipes.get(recipe_id)
    if recipe is None:
        raise EngineError("recipe_not_found", "Рецепт не найден.")
    batch = {
        # Never reused within a menu: a «приготовлено» mark stored by batch id must not move to another dish.
        "id": _next_id(f"b{menu['revision'] + 1}.", [b["id"] for b in menu["batches"]]),
        "recipe_id": recipe_id,
        "recipe_version": recipe["version"],
        "method_id": method_id,
        "cook_date": date,
        "slot": slot,
        "portions": 0,
    }
    menu["batches"].append(batch)
    add_to_snapshot(menu["snapshot"], catalog, recipe_id)
    return batch


def _plan_request(menu: JSON, ctx: JSON, seed: int, current: bool = False) -> JSON:
    # «Пересобрать» (current=True) applies the household's current settings; other edits keep the menu's.
    return {
        "start_date": menu["start_date"],
        "days": menu["days"],
        "seed": seed,
        "slots": list(ctx["slots"]) if current and ctx.get("slots") else list(menu["slots"]),
        "members": list(ctx["members"]) if current else [m for m in ctx["members"] if m["id"] in menu["member_ids"]],
        "slot_members": ctx.get("slot_members"),
        "settings": ctx["settings"] if current and ctx.get("settings") else menu["settings"],
        "pins": [],
        "pantry": ctx.get("pantry") or [],
        "prices": ctx.get("prices"),
    }


def _check_move_date(menu: JSON, item: JSON, date: str) -> None:
    batch = _batch_of(menu, item)
    shared = len([1 for _, i in _all_items(menu) if i["batch_id"] == batch["id"]]) > 1
    if shared and date < batch["cook_date"]:
        raise EngineError("move_before_cook", "Нельзя перенести блюдо из партии на день раньше её приготовления.")


def _retarget_single_use_batch(menu: JSON, item: JSON, meal: JSON) -> None:
    batch = _batch_of(menu, item)
    uses = len([1 for _, i in _all_items(menu) if i["batch_id"] == batch["id"]])
    if uses == 1:
        batch["cook_date"] = meal["date"]
        batch["slot"] = meal["slot"]


def _pinned_recipes(menu: JSON) -> dict[str, JSON]:
    out: dict[str, JSON] = {}
    for _, item in _all_items(menu):
        if not item["pinned"]:
            continue
        batch = _batch_of(menu, item)
        recipe = menu["snapshot"]["recipes"].get(batch["recipe_id"])
        if recipe is not None:
            out[recipe["id"]] = recipe
    return out


_OP_FIELDS: dict[str, dict[str, Any]] = {
    "replace": {"item_id": str},
    "set_portion": {"item_id": str, "member_id": str},
    "move": {"from": dict, "to": dict},
    "pin": {"item_id": str, "pinned": bool},
    "split": {"item_id": str, "member_id": str},
    "add": {"date": str, "slot": str, "recipe_id": str, "member_ids": list},
    "remove": {"item_id": str},
    "regenerate": {"seed": int},
}


def _check_op(op: Any) -> None:
    """Shape of an operation from the API: a malformed one is a 400 with a code, never a crash."""
    if not isinstance(op, dict) or op.get("op") not in _OP_FIELDS:
        raise EngineError("unknown_op", "Неизвестная операция с меню.")
    for key, kind in _OP_FIELDS[op["op"]].items():
        value = op.get(key)
        if not isinstance(value, kind) or (kind is int and isinstance(value, bool)):
            raise EngineError("invalid_op", f"Операция «{op['op']}»: поле «{key}» отсутствует или неверного типа.")
    if op["op"] == "move":
        for end in ("from", "to"):
            if not isinstance(op[end].get("date"), str) or not isinstance(op[end].get("slot"), str):
                raise EngineError("invalid_op", "Перенос: нужны дата и приём пищи.")
    if op["op"] == "add" and not all(isinstance(x, str) for x in op["member_ids"]):
        raise EngineError("invalid_op", "Добавление: участники — список идентификаторов.")
    if op["op"] in ("replace", "split") and op.get("recipe_id") is not None and not isinstance(op["recipe_id"], str):
        raise EngineError("invalid_op", "Идентификатор рецепта должен быть строкой.")


def apply_menu_op(menu: JSON, op: JSON, ctx: JSON) -> JSON:
    """ctx = {"catalog": Catalog, "members": [...], "pantry": [...], "prices": {...} | None}."""
    _check_op(op)
    catalog: Catalog = ctx["catalog"]
    members = {m["id"]: m for m in ctx["members"]}
    nxt = copy.deepcopy(menu)
    kind = op.get("op")

    if kind == "replace":
        meal, item = _find_item(nxt, op["item_id"])
        people = [members[i] for i in item["portions"] if i in members]
        current = _batch_of(nxt, item)
        recipe_id = op.get("recipe_id")
        method_id = op.get("method_id")
        if recipe_id is None:
            ranked = rank_candidates(_plan_request(nxt, ctx, nxt["seed"]), catalog, nxt, meal["date"], meal["slot"], people, item["id"])
            others = [c for c in ranked if c["recipe_id"] != current["recipe_id"]]
            raw_avoid = op.get("avoid") or []
            if not isinstance(raw_avoid, list) or len(raw_avoid) > 500 or not all(isinstance(x, str) for x in raw_avoid):
                raise EngineError("invalid_op", "Список уже предложенных блюд должен быть списком идентификаторов.")
            avoid = set(raw_avoid)
            # Dishes already offered for this meal are skipped; when all were offered, start over.
            pick = next((c for c in others if c["recipe_id"] not in avoid), others[0] if others else None)
            if pick is None:
                raise EngineError("no_replacement", "Нет другого подходящего блюда с учётом запретов, техники и режима повторов.")
            recipe_id = pick["recipe_id"]
            method_id = pick["method_id"]
        method = _check_manual_choice(nxt, catalog, recipe_id, method_id, people, meal["slot"], current["id"])
        batch = _new_batch_for(nxt, catalog, recipe_id, method["id"], meal["date"], meal["slot"])
        item["batch_id"] = batch["id"]
        # A calorie target is met by the portion size, which depends on the dish: recompute it.
        fresh = member_portions(_plan_request(nxt, ctx, nxt["seed"]), catalog, people, recipe_id, meal["slot"])
        for m in people:
            if m["portion_mode"] == "target" and m.get("kcal_target"):
                item["portions"][m["id"]] = fresh[m["id"]]
    elif kind == "set_portion":
        _, item = _find_item(nxt, op["item_id"])
        if op["member_id"] not in item["portions"]:
            raise EngineError("member_not_in_item", "Участник не ест это блюдо.")
        portion = op.get("portion")
        if not isinstance(portion, (int, float)) or isinstance(portion, bool) or not (0.25 <= portion <= 3):
            raise EngineError("invalid_portion", "Порция должна быть от 0,25 до 3 стандартных порций.")
        item["portions"][op["member_id"]] = portion
    elif kind == "move":
        if not is_iso_date(op["to"]["date"]):
            raise EngineError("invalid_date", "Некорректная дата.")
        src = _find_meal(nxt, op["from"]["date"], op["from"]["slot"])
        dst = _find_meal(nxt, op["to"]["date"], op["to"]["slot"])
        moving = list(src["items"])
        back = list(dst["items"])
        for item in moving:
            _check_move_date(nxt, item, dst["date"])
        for item in back:
            _check_move_date(nxt, item, src["date"])
        src["items"] = back
        dst["items"] = moving
        for item in moving:
            _retarget_single_use_batch(nxt, item, dst)
        for item in back:
            _retarget_single_use_batch(nxt, item, src)
        # The explanations of an empty meal travel with it: the meals swap places.
        swapped = []
        for u in nxt["unfilled"]:
            if u["date"] == src["date"] and u["slot"] == src["slot"]:
                u = {**u, "date": dst["date"], "slot": dst["slot"]}
            elif u["date"] == dst["date"] and u["slot"] == dst["slot"]:
                u = {**u, "date": src["date"], "slot": src["slot"]}
            swapped.append(u)
        nxt["unfilled"] = swapped
        # A calorie target depends on the meal: portions moved to another meal are recomputed.
        if src["slot"] != dst["slot"]:
            for target_meal, items in ((dst, moving), (src, back)):
                for item in items:
                    batch = _batch_of(nxt, item)
                    people = [members[i] for i in item["portions"] if i in members]
                    fresh = member_portions(_plan_request(nxt, ctx, nxt["seed"]), catalog, people, batch["recipe_id"], target_meal["slot"])
                    for m in people:
                        if m["portion_mode"] == "target" and m.get("kcal_target"):
                            item["portions"][m["id"]] = fresh[m["id"]]
    elif kind == "pin":
        _, item = _find_item(nxt, op["item_id"])
        item["pinned"] = bool(op["pinned"])
    elif kind == "split":
        meal, item = _find_item(nxt, op["item_id"])
        member = members.get(op["member_id"])
        if member is None or op["member_id"] not in item["portions"]:
            raise EngineError("member_not_in_item", "Участник не ест это блюдо.")
        if len(item["portions"]) < 2:
            raise EngineError("nothing_to_split", "Блюдо и так приготовлено только для одного участника.")
        recipe_id = op.get("recipe_id")
        method_id = None
        if recipe_id is None:
            current = _batch_of(nxt, item)
            ranked = rank_candidates(_plan_request(nxt, ctx, nxt["seed"]), catalog, nxt, meal["date"], meal["slot"], [member], item["id"])
            pick = next((c for c in ranked if c["recipe_id"] != current["recipe_id"]), None)
            if pick is None:
                raise EngineError("no_replacement", "Не найдено отдельного блюда для участника.")
            recipe_id = pick["recipe_id"]
            method_id = pick["method_id"]
        method = _check_manual_choice(nxt, catalog, recipe_id, method_id, [member], meal["slot"])
        portion = item["portions"].pop(op["member_id"])
        batch = _new_batch_for(nxt, catalog, recipe_id, method["id"], meal["date"], meal["slot"])
        if member["portion_mode"] == "target" and member.get("kcal_target"):
            portion = member_portions(_plan_request(nxt, ctx, nxt["seed"]), catalog, [member], recipe_id, meal["slot"])[member["id"]]
        meal["items"].append(
            {
                "id": _next_id("i", [i["id"] for _, i in _all_items(nxt)]),
                "batch_id": batch["id"],
                "portions": {op["member_id"]: portion},
                "pinned": False,
                "alternative_for": item["id"],
            }
        )
    elif kind == "add":
        meal = _find_meal(nxt, op["date"], op["slot"])
        people = [members[i] for i in op["member_ids"] if i in members]
        if not people:
            raise EngineError("no_members", "Выберите, для кого это блюдо.")
        # A batch still eaten elsewhere (a removed meal of a shared batch) is joined again, not cooked twice.
        existing = next(
            (
                b
                for b in nxt["batches"]
                if op.get("batch_id") and b["id"] == op["batch_id"] and b["recipe_id"] == op["recipe_id"] and b["cook_date"] <= meal["date"]
            ),
            None,
        )
        method = _check_manual_choice(nxt, catalog, op["recipe_id"], op.get("method_id"), people, meal["slot"], existing["id"] if existing else None)
        batch = existing or _new_batch_for(nxt, catalog, op["recipe_id"], method["id"], meal["date"], meal["slot"])
        portions = member_portions(_plan_request(nxt, ctx, nxt["seed"]), catalog, people, op["recipe_id"], meal["slot"])
        given_portions = op.get("portions") or {}
        if not isinstance(given_portions, dict):
            raise EngineError("invalid_op", "Порции должны быть объектом {участник: порция}.")
        for m in people:
            given = given_portions.get(m["id"])
            if given is None:
                continue
            if not isinstance(given, (int, float)) or isinstance(given, bool) or not (0.25 <= given <= 3):
                raise EngineError("invalid_portion", "Порция должна быть от 0,25 до 3 стандартных порций.")
            portions[m["id"]] = given
        meal["items"].append(
            {
                "id": _next_id("i", [i["id"] for _, i in _all_items(nxt)]),
                "batch_id": batch["id"],
                "portions": portions,
                "pinned": op.get("pinned") is True,
                "alternative_for": None,
            }
        )
        nxt["unfilled"] = [u for u in nxt["unfilled"] if not (u["date"] == meal["date"] and u["slot"] == meal["slot"])]
    elif kind == "remove":
        meal, _ = _find_item(nxt, op["item_id"])
        meal["items"] = [i for i in meal["items"] if i["id"] != op["item_id"]]
    elif kind == "regenerate":
        req = _plan_request(nxt, ctx, op["seed"], True)
        pins = []
        ids = {m["id"] for m in req["members"]}
        previous: set[str] = set()
        for meal, item in _all_items(nxt):
            batch = _batch_of(nxt, item)
            if not item["pinned"]:
                previous.add(batch["recipe_id"])
                continue
            # A pin stays only for a meal that is still planned and for people still in the family.
            portions = {k: v for k, v in item["portions"].items() if k in ids}
            if meal["slot"] not in req["slots"] or not portions:
                continue
            pins.append(
                {
                    "date": meal["date"],
                    "slot": meal["slot"],
                    "recipe_id": batch["recipe_id"],
                    "method_id": batch["method_id"],
                    "portions": portions,
                }
            )
        req["pins"] = pins
        req["avoid_recipes"] = sorted(previous)
        pinned_catalog = Catalog(
            products=catalog.products, recipes={**catalog.recipes, **_pinned_recipes(nxt)}, reference=catalog.reference, target_sets=catalog.target_sets
        )
        fresh = generate_menu(req, pinned_catalog)["menu"]
        # New batch ids, so a «приготовлено» mark of the old menu never lands on a new dish.
        rename = {b["id"]: f"b{nxt['revision'] + 1}.{i + 1}" for i, b in enumerate(fresh["batches"])}
        for b in fresh["batches"]:
            b["id"] = rename[b["id"]]
        for fmeal in fresh["meals"]:
            for fitem in fmeal["items"]:
                fitem["batch_id"] = rename[fitem["batch_id"]]
        fresh["revision"] = nxt["revision"]
        nxt = fresh
    else:
        raise EngineError("unknown_op", "Неизвестная операция с меню.")

    _normalise_batches(nxt)
    nxt["revision"] = menu["revision"] + 1
    violations = menu_violations(nxt, snapshot_catalog(nxt, catalog), ctx["members"])
    if violations:
        raise EngineError("restriction_violation", violations[0], {"violations": violations})
    return nxt
