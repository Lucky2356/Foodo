"""Validation of plan settings, members and other private documents at the API boundary."""

from __future__ import annotations

import copy
from typing import Any
from zoneinfo import ZoneInfo, available_timezones

from common.errors import ApiError
from engine.generator import DEFAULT_SETTINGS

JSON = dict[str, Any]
SLOTS = ("breakfast", "lunch", "snack", "dinner")
SKILLS = ("beginner", "confident", "any")
DIETS = ("regular", "balanced", "high_protein")
REPEATS = ("unique", "allow", "batch")
EQUIPMENT_IDS = ("stove", "oven", "microwave", "multicooker", "blender", "airfryer")
ACTIVITIES = ("low", "light", "moderate", "high", "very_high")
GOALS = ("maintain", "lose", "gain")
_TIMEZONES = available_timezones()


def _fail(field: str, message: str) -> None:
    raise ApiError("validation_error", message, 400, {"field": field})


def _int(value: Any, field: str, low: int, high: int, nullable: bool = False) -> int | None:
    if value is None and nullable:
        return None
    if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
        _fail(field, f"Поле «{field}»: целое число от {low} до {high}.")
    return value


def _num(value: Any, field: str, low: float, high: float) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not low <= value <= high:
        _fail(field, f"Поле «{field}»: число от {low} до {high}.")
    return value


def _str_list(value: Any, field: str, allowed: tuple[str, ...] | None = None, max_len: int = 200) -> list[str]:
    if not isinstance(value, list) or len(value) > max_len or any(not isinstance(v, str) or len(v) > 100 for v in value):
        _fail(field, f"Поле «{field}»: список строк.")
    if allowed is not None and any(v not in allowed for v in value):
        _fail(field, f"Поле «{field}»: недопустимое значение.")
    return list(dict.fromkeys(value))


def validate_plan_settings(data: Any) -> JSON:
    """Merges with defaults and validates; returns the engine PlanSettings."""
    if not isinstance(data, dict):
        _fail("settings", "Настройки должны быть объектом.")
    s = copy.deepcopy(DEFAULT_SETTINGS)
    # Settings saved before the weekend limit existed keep one limit for every day of the week.
    if "max_total_min_weekend" not in data:
        s["max_total_min_weekend"] = data.get("max_total_min")
    for key, value in data.items():
        if key in s and isinstance(s[key], dict) and isinstance(value, dict):
            s[key] = {**s[key], **value}
        elif key in s:
            s[key] = value
    if s["skill"] not in SKILLS:
        _fail("skill", "Неизвестный уровень готовки.")
    if s["diet_mode"] not in DIETS:
        _fail("diet_mode", "Неизвестный режим питания.")
    s["equipment"] = _str_list(s["equipment"], "equipment", EQUIPMENT_IDS)
    s["max_total_min"] = _int(s["max_total_min"], "max_total_min", 5, 600, nullable=True)
    s["max_total_min_weekend"] = _int(s["max_total_min_weekend"], "max_total_min_weekend", 5, 600, nullable=True)
    s["cuisines"] = _str_list(s["cuisines"], "cuisines", max_len=20)
    r = s["repeat"]
    if r.get("mode") not in REPEATS:
        _fail("repeat.mode", "Неизвестный режим повторов.")
    _int(r.get("max_uses"), "repeat.max_uses", 1, 35)
    _int(r.get("min_gap_days"), "repeat.min_gap_days", 0, 35)
    _int(r.get("batch_days"), "repeat.batch_days", 1, 7)
    if not isinstance(r.get("cook_days"), list) or any(not isinstance(d, int) or not 1 <= d <= 7 for d in r["cook_days"]):
        _fail("repeat.cook_days", "Дни готовки — номера дней недели от 1 до 7.")
    r["batch_slots"] = _str_list(r.get("batch_slots"), "repeat.batch_slots", SLOTS)
    s["repeat"] = {k: r[k] for k in ("mode", "max_uses", "min_gap_days", "cook_days", "batch_days", "batch_slots")}
    if not isinstance(s["container_days"], list) or any(not isinstance(d, int) or not 1 <= d <= 7 for d in s["container_days"]):
        _fail("container_days", "Дни «обед в контейнер» — номера дней недели от 1 до 7.")
    v = s["vitamins"]
    if (
        not isinstance(v.get("enabled"), bool)
        or not isinstance(v.get("demo"), bool)
        or not (v.get("target_set") is None or isinstance(v.get("target_set"), str))
    ):
        _fail("vitamins", "Некорректные настройки учёта витаминов.")
    s["vitamins"] = {"enabled": v["enabled"], "target_set": v.get("target_set"), "demo": v["demo"]}
    b = s["budget"]
    s["budget"] = {"limit_kop": _int(b.get("limit_kop"), "budget.limit_kop", 0, 100_000_000, nullable=True), "currency": str(b.get("currency") or "RUB")[:3]}
    t = s["tolerances"]
    s["tolerances"] = {
        "energy_pct": _num(t.get("energy_pct"), "tolerances.energy_pct", 1, 50),
        "macro_pct": _num(t.get("macro_pct"), "tolerances.macro_pct", 1, 80),
    }
    _num(s["portion_min"], "portion_min", 0.25, 3)
    _num(s["portion_max"], "portion_max", 0.25, 5)
    if s["portion_max"] < s["portion_min"]:
        _fail("portion_max", "Максимальная порция меньше минимальной.")
    return {k: s[k] for k in DEFAULT_SETTINGS}


def validate_household_settings(data: Any) -> JSON:
    if not isinstance(data, dict):
        _fail("settings", "Настройки должны быть объектом.")
    slots = _str_list(data.get("slots", list(SLOTS)), "slots", SLOTS)
    if not slots:
        _fail("slots", "Выберите хотя бы один приём пищи.")
    return {
        "slots": [s for s in SLOTS if s in slots],
        "days": _int(data.get("days", 7), "days", 1, 35),
        "plan": validate_plan_settings(data.get("plan", {})),
        "slot_members": _slot_members(data.get("slot_members")),
        "onboarded": bool(data.get("onboarded", False)),
    }


def _slot_members(value: Any) -> JSON | None:
    if value is None:
        return None
    if not isinstance(value, dict) or any(k not in SLOTS for k in value):
        _fail("slot_members", "Участники приёмов пищи заданы неверно.")
    return {k: _str_list(v, f"slot_members.{k}", max_len=20) for k, v in value.items()}


def _restrictions(value: Any, field: str) -> JSON:
    value = value or {}
    if not isinstance(value, dict):
        _fail(field, "Ограничения должны быть объектом.")
    return {k: _str_list(value.get(k, []), f"{field}.{k}") for k in ("products", "categories", "allergens")}


def validate_member(data: Any, partial: bool = False) -> JSON:
    if not isinstance(data, dict):
        _fail("member", "Ожидается объект участника.")
    out: JSON = {}
    if "name" in data or not partial:
        name = data.get("name")
        if not isinstance(name, str) or not name.strip() or len(name) > 60:
            _fail("name", "Имя или псевдоним — от 1 до 60 символов.")
        out["name"] = name.strip()
    simple_fields = {
        "age": lambda v: _int(v, "age", 0, 120, nullable=True),
        "height_cm": lambda v: None if v is None else _num(v, "height_cm", 40, 250),
        "weight_kg": lambda v: None if v is None else _num(v, "weight_kg", 2, 400),
        "portion_factor": lambda v: _num(v, "portion_factor", 0.25, 3),
        "kcal_target": lambda v: _int(v, "kcal_target", 500, 6000, nullable=True),
        "water_goal_ml": lambda v: _int(v, "water_goal_ml", 0, 10000, nullable=True),
        "position": lambda v: _int(v, "position", 0, 100),
    }
    for key, check in simple_fields.items():
        if key in data:
            out[key] = check(data[key])
    if "sex" in data:
        if data["sex"] not in (None, "male", "female"):
            _fail("sex", "Пол: male, female или не указан.")
        out["sex"] = data["sex"]
    if "activity" in data:
        if data["activity"] not in (None, *ACTIVITIES):
            _fail("activity", "Неизвестный уровень активности.")
        out["activity"] = data["activity"]
    if "goal" in data:
        if data["goal"] not in (None, *GOALS):
            _fail("goal", "Неизвестная цель.")
        out["goal"] = data["goal"]
    if "portion_mode" in data or not partial:
        mode = data.get("portion_mode", "simple")
        if mode not in ("simple", "target"):
            _fail("portion_mode", "Режим порций: simple или target.")
        out["portion_mode"] = mode
    if "restrictions" in data or not partial:
        out["restrictions"] = _restrictions(data.get("restrictions"), "restrictions")
    if "preferences" in data or not partial:
        p = data.get("preferences") or {}
        out["preferences"] = {
            "liked_recipes": _str_list(p.get("liked_recipes", []), "preferences.liked_recipes"),
            "disliked_products": _str_list(p.get("disliked_products", []), "preferences.disliked_products"),
            "liked_products": _str_list(p.get("liked_products", []), "preferences.liked_products"),
        }
    if "diet_types" in data or not partial:
        out["diet_types"] = _str_list(data.get("diet_types") or [], "diet_types", max_len=10)
    if "spice_tolerance" in data or not partial:
        tol = data.get("spice_tolerance", 1)
        out["spice_tolerance"] = 1 if tol is None else _int(tol, "spice_tolerance", 0, 2)
    if "vitamin_targets_manual" in data:
        v = data["vitamin_targets_manual"]
        if v is not None:
            if not isinstance(v, list) or len(v) > 20:
                _fail("vitamin_targets_manual", "Ожидается список целей.")
            for t in v:
                if (
                    not isinstance(t, dict)
                    or t.get("nutrient") not in ("vit_a", "vit_c", "vit_d", "vit_e", "vit_b6", "vit_b12", "folate")
                    or not isinstance(t.get("form"), str)
                ):
                    _fail("vitamin_targets_manual", "Цель: нутриент, значение и форма.")
                _num(t.get("value"), "vitamin_targets_manual.value", 0.001, 100000)
        out["vitamin_targets_manual"] = v
    if "macro_targets" in data:
        out["macro_targets"] = data["macro_targets"] if isinstance(data["macro_targets"], dict) else None
    if "timezone" in data:
        if data["timezone"] not in _TIMEZONES:
            _fail("timezone", "Неизвестный часовой пояс.")
        out["timezone"] = data["timezone"]
    if out.get("portion_mode") == "target" and out.get("age") is not None and out["age"] < 18 and out.get("goal") == "lose":
        _fail("goal", "Для несовершеннолетних цель «снижение веса» не рассчитывается автоматически. Используйте простые порции.")
    return out


def member_json(m: Any) -> JSON:
    return {
        "id": m.id,
        "name": m.name,
        "age": m.age,
        "sex": m.sex,
        "height_cm": m.height_cm,
        "weight_kg": m.weight_kg,
        "activity": m.activity,
        "goal": m.goal,
        "portion_mode": m.portion_mode,
        "portion_factor": m.portion_factor,
        "kcal_target": m.kcal_target,
        "macro_targets": m.macro_targets,
        "restrictions": {"products": [], "categories": [], "allergens": [], **(m.restrictions or {})},
        "diet_types": list(m.diet_types or []),
        "spice_tolerance": m.spice_tolerance,
        "preferences": {"liked_recipes": [], "disliked_products": [], "liked_products": [], **(m.preferences or {})},
        "vitamin_targets_manual": m.vitamin_targets_manual,
        "water_goal_ml": m.water_goal_ml,
        "timezone": m.timezone,
        "position": m.position,
    }


def zone(name: str) -> ZoneInfo:
    return ZoneInfo(name if name in _TIMEZONES else "Europe/Moscow")
