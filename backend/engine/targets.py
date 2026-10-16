"""Energy estimate and vitamin targets; twin of frontend/src/engine/targets.ts."""

from __future__ import annotations

import math
from typing import Any

from .catalog import Catalog
from .nutrition import VITAMIN_IDS

JSON = dict[str, Any]

ACTIVITY_FACTORS = {"low": 1.2, "light": 1.375, "moderate": 1.55, "high": 1.725, "very_high": 1.9}
GOAL_FACTORS = {"maintain": 1, "lose": 0.85, "gain": 1.1}


def estimate_energy(member: JSON) -> JSON:
    method = "Миффлин — Сан Жеор (1990) × коэффициент активности × коэффициент цели (Foodo)"
    age = member.get("age")
    if age is None or age < 18:
        return {
            "available": False,
            "kcal": None,
            "method": method,
            "reason": "Для детей и подростков автоматический расчёт не выполняется: используйте простые порции или задайте цель вручную после консультации со специалистом.",
        }
    if not member.get("sex") or not member.get("weight_kg") or not member.get("height_cm") or not member.get("activity"):
        return {"available": False, "kcal": None, "method": method, "reason": "Нужны пол, вес, рост и активность."}
    base = 10 * member["weight_kg"] + 6.25 * member["height_cm"] - 5 * age + (5 if member["sex"] == "male" else -161)
    goal = GOAL_FACTORS[member["goal"]] if member.get("goal") else 1
    return {"available": True, "kcal": math.floor(base * ACTIVITY_FACTORS[member["activity"]] * goal + 0.5), "method": method, "reason": None}


def _pick_target(targets: list[JSON], nutrient: str, member: JSON) -> JSON | None:
    age = member.get("age")
    for t in targets:
        if t["nutrient"] != nutrient:
            continue
        if t.get("sex") and t["sex"] != member.get("sex"):
            continue
        if t.get("min_age") is not None and (age is None or age < t["min_age"]):
            continue
        if t.get("max_age") is not None and (age is None or age > t["max_age"]):
            continue
        return t
    return None


def resolve_vitamin_targets(catalog: Catalog, member: JSON, set_id: str | None, demo_allowed: bool) -> list[JSON]:
    target_set = catalog.target_sets.get(set_id) if set_id else None
    data_forms = {n["id"]: n["form"] for n in catalog.reference["nutrients"]}
    result: list[JSON] = []

    def row(nutrient: str, status: str, daily: float | None, form: str | None, sid: str | None, sstatus: str | None, message: str) -> JSON:
        return {"nutrient": nutrient, "status": status, "daily": daily, "form": form, "setId": sid, "setStatus": sstatus, "message": message}

    for nutrient in VITAMIN_IDS:
        data_form = data_forms.get(nutrient)
        manual_list = member.get("vitamin_targets_manual")
        manual = _pick_target(manual_list, nutrient, member) if manual_list else None
        if manual is not None:
            if manual["form"] == data_form:
                result.append(row(nutrient, "ok", manual["value"], manual["form"], "manual", "manual", "Цель задана вручную."))
            else:
                result.append(
                    row(
                        nutrient,
                        "incompatible_form",
                        None,
                        manual["form"],
                        "manual",
                        "manual",
                        f"Форма цели ({manual['form']}) не совпадает с формой данных продуктов ({data_form or 'нет'}).",
                    )
                )
            continue
        if target_set is None:
            result.append(row(nutrient, "no_target", None, None, None, None, "Целевая норма не выбрана."))
            continue
        if target_set["demo"] and not demo_allowed:
            result.append(
                row(
                    nutrient,
                    "demo_not_allowed",
                    None,
                    None,
                    target_set["id"],
                    target_set["status"],
                    "Демонстрационные значения не применяются к реальным профилям.",
                )
            )
            continue
        min_age = target_set.get("min_age")
        if min_age is not None and (member.get("age") is None or member["age"] < min_age):
            result.append(
                row(
                    nutrient,
                    "not_applicable",
                    None,
                    None,
                    target_set["id"],
                    target_set["status"],
                    f"Набор «{target_set['name']}» рассчитан на возраст от {min_age} лет.",
                )
            )
            continue
        target = _pick_target(target_set["targets"], nutrient, member)
        if target is None:
            result.append(row(nutrient, "no_target", None, None, target_set["id"], target_set["status"], "В выбранном наборе нет цели для этого участника."))
            continue
        if target["form"] != data_form:
            result.append(
                row(
                    nutrient,
                    "incompatible_form",
                    None,
                    target["form"],
                    target_set["id"],
                    target_set["status"],
                    target.get("note") or f"Форма цели ({target['form']}) не совпадает с формой данных продуктов ({data_form or 'нет'}).",
                )
            )
            continue
        status = target_set["status"]
        message = (
            "Значение не сверено с первоисточником."
            if status == "unverified"
            else "Демонстрационное значение, не норма."
            if status == "demo"
            else "Значение из справочника."
        )
        result.append(row(nutrient, "ok", target["value"], target["form"], target_set["id"], status, message))
    return result
