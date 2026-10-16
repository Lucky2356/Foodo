"""Validation of catalog imports (JSON/CSV and the seed). Nothing from an import is executed;
every reference, unit and number is checked before anything is written."""

from __future__ import annotations

import re
from typing import Any

from engine.nutrition import NUTRIENT_IDS

SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,99}$")
RECIPE_UNITS = {"g", "kg", "ml", "l", "pcs", "tbsp", "tsp", "pinch"}
BASE_UNITS = {"g", "ml", "pcs"}
PACKAGE_UNITS = {"g", "kg", "ml", "l", "pcs"}
STATES = {"raw", "dry", "cooked", "processed"}
SPOONS = {"tbsp", "tsp", "pinch"}

Error = dict[str, str]


def _num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _err(errors: list[Error], path: str, code: str, message: str) -> None:
    errors.append({"path": path, "code": code, "message": message})


def validate_products(products: Any, categories: set[str], allergens: set[str], known_products: set[str]) -> list[Error]:
    errors: list[Error] = []
    if not isinstance(products, list):
        return [{"path": "products", "code": "not_a_list", "message": "Ожидается список продуктов."}]
    ids = [p.get("id") for p in products if isinstance(p, dict)]
    all_ids = known_products | {i for i in ids if isinstance(i, str)}
    seen: set[str] = set()
    for index, p in enumerate(products):
        path = f"products[{index}]"
        if not isinstance(p, dict):
            _err(errors, path, "not_an_object", "Ожидается объект продукта.")
            continue
        pid = p.get("id")
        if not isinstance(pid, str) or not SLUG.match(pid):
            _err(errors, f"{path}.id", "invalid_id", "Идентификатор: латиница, цифры, «_» и «-».")
        elif pid in seen:
            _err(errors, f"{path}.id", "duplicate_id", f"Продукт {pid} повторяется в файле.")
        else:
            seen.add(pid)
        if not isinstance(p.get("name"), str) or not p["name"].strip() or len(p["name"]) > 200:
            _err(errors, f"{path}.name", "invalid_name", "Нужно название до 200 символов.")
        if p.get("category") not in categories:
            _err(errors, f"{path}.category", "unknown_category", f"Неизвестная категория: {p.get('category')}.")
        if not isinstance(p.get("department"), str) or not p["department"]:
            _err(errors, f"{path}.department", "invalid_department", "Нужен отдел магазина.")
        if p.get("state") not in STATES:
            _err(errors, f"{path}.state", "invalid_state", "Состояние: raw, dry, cooked или processed.")
        if p.get("base_unit") not in BASE_UNITS:
            _err(errors, f"{path}.base_unit", "invalid_unit", "Базовая единица: g, ml или pcs.")
        ef = p.get("edible_fraction")
        if not _num(ef) or not 0 < ef <= 1:
            _err(errors, f"{path}.edible_fraction", "invalid_fraction", "Съедобная доля — число от 0 до 1.")
        for key in ("piece_g", "density_g_ml"):
            v = p.get(key)
            if v is not None and (not _num(v) or v <= 0):
                _err(errors, f"{path}.{key}", "invalid_number", "Должно быть положительным числом.")
        if p.get("base_unit") == "pcs" and not p.get("piece_g"):
            _err(errors, f"{path}.piece_g", "piece_required", "Для продуктов в штуках нужна масса штуки.")
        if p.get("base_unit") == "ml" and not p.get("density_g_ml") and p.get("spoon_g"):
            pass  # allowed: such products simply cannot be converted spoon→ml
        spoon = p.get("spoon_g") or {}
        if not isinstance(spoon, dict) or any(k not in SPOONS or not _num(v) or v <= 0 for k, v in spoon.items()):
            _err(errors, f"{path}.spoon_g", "invalid_spoons", "Ложки: tbsp, tsp, pinch с массой в граммах.")
        pkg = p.get("package")
        if pkg is not None and (not isinstance(pkg, dict) or not _num(pkg.get("size")) or pkg["size"] <= 0 or pkg.get("unit") not in PACKAGE_UNITS):
            _err(errors, f"{path}.package", "invalid_package", "Упаковка: размер и единица (g, kg, ml, l, pcs).")
        for a in p.get("allergens", []):
            if a not in allergens:
                _err(errors, f"{path}.allergens", "unknown_allergen", f"Неизвестный аллерген: {a}.")
        for c in p.get("contains", []):
            if c not in all_ids:
                _err(errors, f"{path}.contains", "unknown_product", f"Состав ссылается на неизвестный продукт: {c}.")
            if c == pid:
                _err(errors, f"{path}.contains", "self_reference", "Продукт не может содержать сам себя.")
        if not isinstance(p.get("composition_known", True), bool):
            _err(errors, f"{path}.composition_known", "invalid_bool", "Ожидается true или false.")
        nutrients = p.get("nutrients")
        if not isinstance(nutrients, dict):
            _err(errors, f"{path}.nutrients", "invalid_nutrients", "Нужен объект нутриентов на 100 г.")
        else:
            for key, value in nutrients.items():
                if key not in NUTRIENT_IDS:
                    _err(errors, f"{path}.nutrients.{key}", "unknown_nutrient", f"Неизвестный нутриент: {key}.")
                elif value is not None and (not _num(value) or value < 0):
                    _err(errors, f"{path}.nutrients.{key}", "invalid_value", "Значение — неотрицательное число или null (нет данных).")
        if not isinstance(p.get("source"), str) or not p["source"]:
            _err(errors, f"{path}.source", "source_required", "Укажите источник пищевой ценности.")
    return errors


def validate_recipes(recipes: Any, products: set[str], reference: dict[str, Any]) -> list[Error]:
    errors: list[Error] = []
    if not isinstance(recipes, list):
        return [{"path": "recipes", "code": "not_a_list", "message": "Ожидается список рецептов."}]
    slots = {s["id"] for s in reference.get("meal_slots", [])}
    equipment = set(reference.get("equipment_ids", []))
    techniques = set(reference.get("technique_ids", []))
    diet_tags = set(reference.get("diet_tag_ids", []))
    categories = {c["id"] for c in reference.get("recipe_categories", [])}
    seen: set[str] = set()
    for index, r in enumerate(recipes):
        path = f"recipes[{index}]"
        if not isinstance(r, dict):
            _err(errors, path, "not_an_object", "Ожидается объект рецепта.")
            continue
        rid = r.get("id")
        if not isinstance(rid, str) or not SLUG.match(rid):
            _err(errors, f"{path}.id", "invalid_id", "Идентификатор: латиница, цифры, «_» и «-».")
        elif rid in seen:
            _err(errors, f"{path}.id", "duplicate_id", f"Рецепт {rid} повторяется в файле.")
        else:
            seen.add(rid)
        if not isinstance(r.get("name"), str) or not r["name"].strip() or len(r["name"]) > 200:
            _err(errors, f"{path}.name", "invalid_name", "Нужно название до 200 символов.")
        if r.get("category") not in categories:
            _err(errors, f"{path}.category", "unknown_category", f"Неизвестная категория рецепта: {r.get('category')}.")
        meal_types = r.get("meal_types")
        if not isinstance(meal_types, list) or not meal_types or any(m not in slots for m in meal_types):
            _err(errors, f"{path}.meal_types", "invalid_meal_types", "Укажите приёмы пищи из справочника.")
        servings = r.get("servings")
        if not isinstance(servings, int) or isinstance(servings, bool) or not 1 <= servings <= 50:
            _err(errors, f"{path}.servings", "invalid_servings", "Порций — целое число от 1 до 50.")
        y = r.get("yield_g")
        if y is not None and (not _num(y) or y <= 0):
            _err(errors, f"{path}.yield_g", "invalid_yield", "Выход — положительное число или null, если неизвестен.")
        ingredients = r.get("ingredients")
        if not isinstance(ingredients, list) or not ingredients:
            _err(errors, f"{path}.ingredients", "no_ingredients", "Нужен хотя бы один ингредиент.")
            ingredients = []
        for j, ing in enumerate(ingredients):
            ipath = f"{path}.ingredients[{j}]"
            if not isinstance(ing, dict):
                _err(errors, ipath, "not_an_object", "Ожидается объект ингредиента.")
                continue
            if ing.get("product") not in products:
                _err(errors, f"{ipath}.product", "unknown_product", f"Неизвестный продукт: {ing.get('product')}.")
            if not _num(ing.get("qty")) or ing["qty"] <= 0:
                _err(errors, f"{ipath}.qty", "invalid_qty", "Количество — положительное число.")
            if ing.get("unit") not in RECIPE_UNITS:
                _err(errors, f"{ipath}.unit", "invalid_unit", f"Недопустимая единица: {ing.get('unit')}.")
        methods = r.get("methods")
        if not isinstance(methods, list) or not methods:
            _err(errors, f"{path}.methods", "no_methods", "Нужен хотя бы один способ приготовления.")
            methods = []
        method_ids: set[str] = set()
        for j, m in enumerate(methods):
            mpath = f"{path}.methods[{j}]"
            if not isinstance(m, dict):
                _err(errors, mpath, "not_an_object", "Ожидается объект способа.")
                continue
            mid = m.get("id")
            if not isinstance(mid, str) or not SLUG.match(mid) or mid in method_ids:
                _err(errors, f"{mpath}.id", "invalid_method_id", "Код способа должен быть уникальным.")
            else:
                method_ids.add(mid)
            if not isinstance(m.get("name"), str) or not m["name"]:
                _err(errors, f"{mpath}.name", "invalid_name", "Нужно название способа.")
            eq = m.get("equipment")
            if not isinstance(eq, list) or any(e not in equipment for e in eq):
                _err(errors, f"{mpath}.equipment", "unknown_equipment", "Техника должна быть из справочника.")
            for key in ("active_min", "total_min"):
                v = m.get(key)
                if not isinstance(v, int) or isinstance(v, bool) or not 0 <= v <= 24 * 60:
                    _err(errors, f"{mpath}.{key}", "invalid_time", "Время в минутах, от 0 до 1440.")
            if isinstance(m.get("active_min"), int) and isinstance(m.get("total_min"), int) and m["active_min"] > m["total_min"]:
                _err(errors, f"{mpath}.active_min", "active_gt_total", "Активное время не может быть больше общего.")
            steps = m.get("steps")
            if not isinstance(steps, list) or not steps or any(not isinstance(s, str) or not s.strip() for s in steps):
                _err(errors, f"{mpath}.steps", "invalid_steps", "Нужны непустые шаги.")
        techs = r.get("techniques")
        if techs is not None and (not isinstance(techs, list) or any(t not in techniques for t in techs)):
            _err(errors, f"{path}.techniques", "unknown_technique", "Приёмы должны быть из справочника (или null, если неизвестны).")
        tags = r.get("diet_tags", [])
        if not isinstance(tags, list) or any(t not in diet_tags for t in tags):
            _err(errors, f"{path}.diet_tags", "unknown_diet_tag", "Теги режима питания должны быть из справочника.")
        if not isinstance(r.get("container_ok"), bool):
            _err(errors, f"{path}.container_ok", "invalid_bool", "Ожидается true или false.")
        image = r.get("image")
        if image is not None:
            if not isinstance(image, dict) or not all(isinstance(image.get(k), str) and image.get(k) for k in ("url", "source", "license")):
                _err(errors, f"{path}.image", "invalid_image", "Изображение: url, source и license обязательны.")
    return errors
