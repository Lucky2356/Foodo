"""Menu generator; operation-by-operation twin of frontend/src/engine/generator.ts.

See the TypeScript module for the algorithm description. Any change here must be mirrored there
and the shared fixtures regenerated (npm run fixtures:write) and committed.
"""

from __future__ import annotations

import copy
import math
from typing import Any, TypeGuard

from .basics import Rng, add_days, clamp, is_iso_date, iso_weekday
from .catalog import Catalog, add_to_snapshot, find_method, recipe_ids
from .errors import EngineError
from .nutrition import VITAMIN_IDS, NutritionCache, Table
from .restrictions import (
    REASON_MESSAGES,
    effective_restrictions,
    is_recipe_safe_for,
    kitchen_check,
    recipe_has_disliked_product,
    recipe_has_liked_product,
    recipe_spice,
    recipe_violations,
    spice_tolerance,
)
from .shopping import compute_shopping, empty_shopping_state, unit_price_kop
from .targets import resolve_vitamin_targets
from .units import to_base

JSON = dict[str, Any]

SCORE = {
    "liked": 1.5,
    "disliked": -2,
    "likedProduct": 0.6,
    "cuisine": 0.8,
    "kidFriendly": 0.6,
    "sameCategorySameDay": -0.5,
    "repeatUse": -1,
    "sharedIngredient": 0.15,
    "sharedIngredientCap": 1,
    "timePer120Min": 1,
    "vitamins": 1,
    "jitter": 0.35,
    "unfilledPenalty": 100,
    "budgetExceededPenalty": 1000,
    "maxEvaluations": 250000,
}

DEFAULT_SETTINGS: JSON = {
    "skill": "any",
    "diet_mode": "regular",
    "equipment": ["stove", "oven", "microwave"],
    "max_total_min": None,
    "max_total_min_weekend": None,
    "cuisines": [],
    "repeat": {"mode": "unique", "max_uses": 2, "min_gap_days": 2, "cook_days": [], "batch_days": 2, "batch_slots": ["lunch", "dinner"]},
    "container_days": [],
    "vitamins": {"enabled": False, "target_set": None, "demo": False},
    "budget": {"limit_kop": None, "currency": "RUB"},
    "tolerances": {"energy_pct": 10, "macro_pct": 20},
    "portion_min": 0.5,
    "portion_max": 2,
}


def _is_int(value: Any) -> TypeGuard[int | float]:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    return isinstance(value, float) and value.is_integer()


def validate_plan_request(req: JSON, catalog: Catalog) -> None:
    if not is_iso_date(req.get("start_date")):
        raise EngineError("invalid_date", "Некорректная дата начала меню.")
    days = req.get("days")
    if not _is_int(days) or days < 1 or days > 35:
        raise EngineError("invalid_days", "Период меню должен быть от 1 до 35 дней.")
    seed = req.get("seed")
    if not _is_int(seed) or seed < 0 or seed > 4294967295:
        raise EngineError("invalid_seed", "Seed должен быть целым числом от 0 до 4294967295.")
    if len(req["slots"]) == 0:
        raise EngineError("no_slots", "Выберите хотя бы один приём пищи.")
    known = {s["id"] for s in catalog.reference["meal_slots"]}
    for s in req["slots"]:
        if s not in known:
            raise EngineError("unknown_slot", f"Неизвестный приём пищи: {s}.")
    if len(set(req["slots"])) != len(req["slots"]):
        raise EngineError("duplicate_slot", "Приёмы пищи повторяются.")
    if len(req["members"]) == 0:
        raise EngineError("no_members", "Добавьте хотя бы одного участника.")
    if len(req["members"]) > 20:
        raise EngineError("too_many_members", "В одной семье может быть не больше 20 участников.")
    s = req["settings"]
    if not (s["portion_min"] > 0 and s["portion_max"] >= s["portion_min"] and s["portion_max"] <= 5):
        raise EngineError("invalid_portion_range", "Некорректный диапазон порций.")
    r = s["repeat"]
    if r["mode"] != "unique" and (r["max_uses"] < 1 or r["min_gap_days"] < 0):
        raise EngineError("invalid_repeat", "Некорректные параметры повторов.")
    if r["mode"] == "batch" and (r["batch_days"] < 1 or r["batch_days"] > 7):
        raise EngineError("invalid_batch_days", "Партия может использоваться от 1 до 7 дней.")
    limit = s["budget"]["limit_kop"]
    if limit is not None and (not _is_int(limit) or limit < 0):
        raise EngineError("invalid_budget", "Бюджет должен быть неотрицательной суммой.")
    if not any(m["id"] == s["diet_mode"] for m in catalog.reference["diet_modes"]):
        raise EngineError("unknown_diet_mode", "Неизвестный режим питания.")
    for limit_value in (s["max_total_min"], s.get("max_total_min_weekend")):
        if limit_value is not None and (not _is_int(limit_value) or limit_value < 5 or limit_value > 1440):
            raise EngineError("invalid_time_limit", "Лимит времени готовки должен быть от 5 до 1440 минут.")
    cuisines = {c["id"] for c in catalog.reference.get("cuisines") or []}
    for c in s.get("cuisines") or []:
        if c not in cuisines:
            raise EngineError("unknown_cuisine", f"Неизвестная кухня: {c}.")
    diet_types = {t["id"] for t in catalog.reference.get("diet_types") or []}
    for m in req["members"]:
        for t in m.get("diet_types") or []:
            if t not in diet_types:
                raise EngineError("unknown_diet_type", f"Неизвестный тип питания у участника «{m['name']}»: {t}.")
        tol = m.get("spice_tolerance")
        if tol is not None and (not _is_int(tol) or tol < 0 or tol > 2):
            raise EngineError("invalid_spice_tolerance", f"Допустимая острота у участника «{m['name']}» должна быть 0, 1 или 2.")
    vit = s["vitamins"]
    if vit["enabled"] and vit["target_set"]:
        target_set = catalog.target_sets.get(vit["target_set"])
        if target_set is None:
            raise EngineError("unknown_target_set", "Выбранный набор целевых значений не найден.")
        if target_set["demo"] and not vit["demo"]:
            raise EngineError("demo_targets_not_allowed", "Демонстрационные нормы можно использовать только в демонстрационном сценарии.")


class _State:
    def __init__(self, members: list[JSON]) -> None:
        self.uses: dict[str, int] = {}
        self.last_day: dict[str, int] = {}
        self.products: set[str] = set()
        self.vit_have: dict[str, dict[str, float]] = {m["id"]: {} for m in members}
        self.categories_by_day: dict[int, set[str]] = {}
        self.batches: list[JSON] = []
        self.meals: list[JSON] = []
        self.unfilled: list[JSON] = []
        self.conflicts: list[JSON] = []
        self.warnings: list[str] = []
        self.active_batch: dict[str, JSON] = {}
        self.score: float = 0
        self.batch_seq = 0
        self.item_seq = 0


class _Planner:
    def __init__(self, req: JSON, catalog: Catalog) -> None:
        self.req = req
        self.catalog = catalog
        self.recipes = recipe_ids(catalog)
        self.nutrition = NutritionCache(catalog)
        self.dates = [add_days(req["start_date"], d) for d in range(req["days"])]
        share_sum: float = 0
        for s in req["slots"]:
            share_sum += self.slot_ref(s)["energy_share"]
        self.slot_share = {s: self.slot_ref(s)["energy_share"] / share_sum for s in req["slots"]}
        self.kitchen_cache: dict[str, JSON] = {}
        self.safe_cache: dict[str, bool] = {}
        self.unit_prices: dict[str, float | None] = {}
        self.recipe_products: dict[str, list[str]] = {}
        for rid in self.recipes:
            products: list[str] = []
            for ing in catalog.recipes[rid]["ingredients"]:
                p = catalog.products.get(ing["product"])
                if p is not None and p.get("purchasable") is not False and p["id"] not in products:
                    products.append(p["id"])
            self.recipe_products[rid] = products
        self.kcal_targets: dict[str, float | None] = {}
        self.vit_targets: dict[str, dict[str, float]] = {}
        vit = req["settings"]["vitamins"]
        for m in req["members"]:
            self.kcal_targets[m["id"]] = m["kcal_target"] if m["portion_mode"] == "target" and m.get("kcal_target") else None
            targets: dict[str, float] = {}
            if vit["enabled"]:
                for t in resolve_vitamin_targets(catalog, m, vit["target_set"], vit["demo"]):
                    if t["status"] == "ok" and t["daily"] is not None and t["daily"] > 0:
                        targets[t["nutrient"]] = t["daily"] * req["days"]
            self.vit_targets[m["id"]] = targets
        self.evaluated = 0

    def slot_ref(self, slot: str) -> JSON:
        for s in self.catalog.reference["meal_slots"]:
            if s["id"] == slot:
                return s
        raise EngineError("unknown_slot", f"Неизвестный приём пищи: {slot}.")

    def participants(self, slot: str) -> list[JSON]:
        slot_members = self.req.get("slot_members") or {}
        ids = slot_members.get(slot)
        return [m for m in self.req["members"] if ids is None or m["id"] in ids]

    def is_weekend(self, day: int) -> bool:
        """Saturday and Sunday may have their own cooking time limit."""
        return iso_weekday(self.dates[day]) >= 6

    def time_limit(self, weekend: bool) -> int | None:
        s = self.req["settings"]
        # A missing weekend limit (older settings) means «same as weekdays»; None means «no limit».
        if weekend and "max_total_min_weekend" in s:
            return s["max_total_min_weekend"]
        return s["max_total_min"]

    def kitchen(self, recipe_id: str, slot: str, container: bool, weekend: bool = False) -> JSON:
        key = f"{recipe_id}|{slot}|{1 if container else 0}|{1 if weekend else 0}"
        check = self.kitchen_cache.get(key)
        if check is None:
            s = self.req["settings"]
            check = kitchen_check(self.catalog, self.catalog.recipes[recipe_id], slot, s["equipment"], s["skill"], self.time_limit(weekend), container)
            self.kitchen_cache[key] = check
        return check

    def safe(self, recipe_id: str, member: JSON) -> bool:
        key = f"{recipe_id}|{member['id']}"
        ok = self.safe_cache.get(key)
        if ok is None:
            ok = is_recipe_safe_for(self.catalog, self.catalog.recipes[recipe_id], member)
            self.safe_cache[key] = ok
        return ok

    def unit_price(self, product_id: str) -> float | None:
        if product_id not in self.unit_prices:
            product = self.catalog.products.get(product_id)
            self.unit_prices[product_id] = unit_price_kop(self.req.get("prices"), product) if product is not None else None
        return self.unit_prices[product_id]

    def per_serving(self, recipe_id: str) -> Table:
        return self.nutrition.per_serving(recipe_id)

    def portion(self, member: JSON, recipe_id: str, slot: str) -> float:
        s = self.req["settings"]
        kcal_target = self.kcal_targets.get(member["id"])
        if kcal_target is not None:
            meal_kcal = kcal_target * self.slot_share.get(slot, 0)
            serving = self.per_serving(recipe_id)["kcal"]["value"]
            if serving > 0:
                return clamp(math.floor(meal_kcal / serving * 20 + 0.5) / 20, s["portion_min"], s["portion_max"])
            return clamp(1, s["portion_min"], s["portion_max"])
        return clamp(member["portion_factor"], 0.25, 3)

    def repeat_allowed(self, state: _State, recipe_id: str, day: int) -> bool:
        r = self.req["settings"]["repeat"]
        uses = state.uses.get(recipe_id, 0)
        if r["mode"] == "unique":
            return uses == 0
        if uses >= r["max_uses"]:
            return False
        last = state.last_day.get(recipe_id)
        return last is None or day - last >= r["min_gap_days"]

    def estimate_cost(self, recipe_id: str, total_portions: float) -> float:
        recipe = self.catalog.recipes[recipe_id]
        scale = total_portions / recipe["servings"]
        cost: float = 0
        for ing in recipe["ingredients"]:
            product = self.catalog.products.get(ing["product"])
            if product is None or product.get("purchasable") is False:
                continue
            price = self.unit_price(product["id"])
            if price is None:
                continue
            base = to_base(product, ing["qty"] * scale, ing["unit"])
            if base is None:
                continue
            cost += base * price
        return cost

    def vitamin_gain(self, state: _State, recipe_id: str, portions: dict[str, float], people: list[JSON]) -> float:
        meals = self.req["days"] * len(self.req["slots"])
        gain: float = 0
        serving = self.per_serving(recipe_id)
        for m in people:
            targets = self.vit_targets[m["id"]]
            have = state.vit_have[m["id"]]
            factor = portions.get(m["id"], 0)
            for vit in VITAMIN_IDS:
                period = targets.get(vit)
                if period is None:
                    continue
                amount = serving[vit]
                if not amount["complete"]:
                    continue
                current = have.get(vit, 0)
                add = amount["value"] * factor
                shares = (min(period, current + add) - min(period, current)) / period * meals
                gain += min(1, shares)
        return gain

    def score(
        self, state: _State, recipe_id: str, people: list[JSON], day: int, slot: str, container: bool, cost_weight: float, budget_per_meal: float
    ) -> float:
        recipe = self.catalog.recipes[recipe_id]
        s = self.req["settings"]
        score: float = 0
        rules = self.catalog.reference["diet_rules"].get(s["diet_mode"]) or {}
        for tag in recipe["diet_tags"]:
            w = rules.get(tag)
            if w is not None:
                score += w
        for m in people:
            if recipe_id in m["preferences"]["liked_recipes"]:
                score += SCORE["liked"]
            if recipe_has_disliked_product(self.catalog, recipe, m):
                score += SCORE["disliked"]
            if recipe_has_liked_product(self.catalog, recipe, m):
                score += SCORE["likedProduct"]
            if recipe.get("kid_friendly") is True and m.get("age") is not None and m["age"] < 12:
                score += SCORE["kidFriendly"]
        cuisines = s.get("cuisines") or []
        if cuisines and recipe.get("cuisine") and recipe["cuisine"] in cuisines:
            score += SCORE["cuisine"]
        if recipe["category"] in state.categories_by_day.get(day, set()):
            score += SCORE["sameCategorySameDay"]
        score += SCORE["repeatUse"] * state.uses.get(recipe_id, 0)
        shared = 0
        for pid in self.recipe_products.get(recipe_id, []):
            if pid in state.products:
                shared += 1
        score += min(shared * SCORE["sharedIngredient"], SCORE["sharedIngredientCap"])
        method = self.kitchen(recipe_id, slot, container, self.is_weekend(day))["method"]
        if method is not None:
            score -= method["total_min"] / 120 * SCORE["timePer120Min"]
        portions: dict[str, float] = {}
        total: float = 0
        for m in people:
            f = self.portion(m, recipe_id, slot)
            portions[m["id"]] = f
            total += f
        if cost_weight > 0 and budget_per_meal > 0:
            score -= cost_weight * self.estimate_cost(recipe_id, total) / budget_per_meal
        if s["vitamins"]["enabled"]:
            score += SCORE["vitamins"] * self.vitamin_gain(state, recipe_id, portions, people) / len(people)
        return score

    def pick_best(
        self,
        state: _State,
        candidates: list[str],
        people: list[JSON],
        day: int,
        slot: str,
        container: bool,
        rng: Rng,
        cost_weight: float,
        budget_per_meal: float,
    ) -> tuple[str, float] | None:
        best: str | None = None
        best_score = -math.inf
        for rid in candidates:
            self.evaluated += 1
            if self.evaluated > SCORE["maxEvaluations"]:
                raise EngineError("search_limit", "Превышен лимит перебора. Сократите период или число участников.")
            value = self.score(state, rid, people, day, slot, container, cost_weight, budget_per_meal) + SCORE["jitter"] * rng.next()
            if value > best_score:
                best_score = value
                best = rid
        return None if best is None else (best, best_score)

    def candidates_for(self, state: _State, people: list[JSON], day: int, slot: str, container: bool) -> list[str]:
        out: list[str] = []
        for rid in self.recipes:
            if self.kitchen(rid, slot, container, self.is_weekend(day))["method"] is None:
                continue
            if not all(self.safe(rid, m) for m in people):
                continue
            if not self.repeat_allowed(state, rid, day):
                continue
            out.append(rid)
        return out

    def explain_empty(self, state: _State, people: list[JSON], day: int, slot: str, container: bool) -> tuple[str, str]:
        counts: dict[str, int] = {}
        repeat_only = 0
        for rid in self.recipes:
            check = self.kitchen(rid, slot, container, self.is_weekend(day))
            if check["reasons"]:
                for r in check["reasons"]:
                    counts[r] = counts.get(r, 0) + 1
                continue
            blocked = [m for m in people if not self.safe(rid, m)]
            if blocked:
                recipe = self.catalog.recipes[rid]
                for m in blocked:
                    too_spicy = recipe_spice(recipe) > spice_tolerance(m)
                    key = f"{'spicy' if too_spicy else 'restriction'}:{m['name']}"
                    counts[key] = counts.get(key, 0) + 1
                continue
            if not self.repeat_allowed(state, rid, day):
                counts["repeat"] = counts.get("repeat", 0) + 1
                repeat_only += 1
        parts: list[str] = []
        for key in sorted(counts.keys()):
            n = counts[key]
            if key.startswith("restriction:"):
                parts.append(f"{n} — запреты участника «{key[12:]}»")
            elif key.startswith("spicy:"):
                parts.append(f"{n} — острее, чем допускает участник «{key[6:]}»")
            else:
                parts.append(f"{n} — {REASON_MESSAGES.get(key, key)}")
        slot_name = self.slot_ref(slot)["name"]
        message = f"Для «{slot_name}» не найдено подходящего блюда. Из {len(self.recipes)} рецептов отсеяны: {'; '.join(parts)}."
        return ("repeat_exhausted" if repeat_only > 0 else "no_candidates", message)

    def new_batch(self, state: _State, recipe_id: str, method_id: str, date: str, slot: str) -> JSON:
        state.batch_seq += 1
        recipe = self.catalog.recipes[recipe_id]
        batch = {
            "id": f"b{state.batch_seq}",
            "recipe_id": recipe_id,
            "recipe_version": recipe["version"],
            "method_id": method_id,
            "cook_date": date,
            "slot": slot,
            "portions": 0,
        }
        state.batches.append(batch)
        return batch

    def add_item(
        self, state: _State, meal: JSON, batch: JSON, people: list[JSON], day: int, pinned: bool, count_use: bool, fixed_portions: dict[str, float] | None
    ) -> JSON:
        state.item_seq += 1
        portions: dict[str, float] = {}
        for m in people:
            fixed = fixed_portions.get(m["id"]) if fixed_portions is not None else None
            f = fixed if fixed is not None else self.portion(m, batch["recipe_id"], meal["slot"])
            portions[m["id"]] = f
            batch["portions"] += f
            have = state.vit_have[m["id"]]
            serving = self.per_serving(batch["recipe_id"])
            for vit in VITAMIN_IDS:
                amount = serving[vit]
                if amount["complete"]:
                    have[vit] = have.get(vit, 0) + amount["value"] * f
        item = {"id": f"i{state.item_seq}", "batch_id": batch["id"], "portions": portions, "pinned": pinned, "alternative_for": None}
        meal["items"].append(item)
        recipe = self.catalog.recipes[batch["recipe_id"]]
        if count_use:
            state.uses[recipe["id"]] = state.uses.get(recipe["id"], 0) + 1
            for pid in self.recipe_products.get(recipe["id"], []):
                state.products.add(pid)
        state.last_day[recipe["id"]] = day
        state.categories_by_day.setdefault(day, set()).add(recipe["category"])
        return item

    def batch_until(self, day: int) -> int:
        r = self.req["settings"]["repeat"]
        until = min(day + r["batch_days"] - 1, self.req["days"] - 1)
        if r["cook_days"]:
            for d in range(day + 1, until + 1):
                if iso_weekday(self.dates[d]) in r["cook_days"]:
                    until = d - 1
                    break
        return until

    def empty_state(self) -> _State:
        return _State(self.req["members"])

    def build(self, rng: Rng, cost_weight: float) -> _State:
        req = self.req
        s = req["settings"]
        state = self.empty_state()
        limit = s["budget"]["limit_kop"]
        budget_per_meal = limit / (req["days"] * len(req["slots"])) if limit is not None else 0
        pins: dict[str, list[JSON]] = {}
        for pin in req.get("pins") or []:
            pins.setdefault(f"{pin['date']}|{pin['slot']}", []).append(pin)
        pinned_uses: dict[str, int] = {}
        repeat = s["repeat"]

        for day in range(req["days"]):
            date = self.dates[day]
            weekday = iso_weekday(date)
            for slot in req["slots"]:
                meal: JSON = {"date": date, "slot": slot, "items": []}
                people = self.participants(slot)
                container = slot == "lunch" and weekday in s["container_days"]

                for pin in pins.get(f"{date}|{slot}", []):
                    recipe = self.catalog.recipes.get(pin["recipe_id"])
                    method = find_method(recipe, pin["method_id"]) if recipe is not None else None
                    pin_people = [m for m in people if m["id"] in pin["portions"]]
                    unsafe = [m for m in pin_people if not self.safe(recipe["id"], m)] if recipe is not None else pin_people
                    if recipe is None or method is None or unsafe or not pin_people:
                        if recipe is None:
                            why = "рецепт удалён"
                        elif method is None:
                            why = "способ приготовления недоступен"
                        elif unsafe:
                            why = "оно нарушает запреты участника «" + "», «".join(m["name"] for m in unsafe) + "»"
                        else:
                            why = "участники не входят в этот приём пищи"
                        state.conflicts.append(
                            {
                                "code": "pin_invalid",
                                "message": f"Закреплённое блюдо на {date} ({self.slot_ref(slot)['name']}) нельзя сохранить: {why}.",
                                "suggestion": "Снимите закрепление или замените блюдо вручную.",
                            }
                        )
                        continue
                    used = pinned_uses.get(recipe["id"], 0)
                    pinned_uses[recipe["id"]] = used + 1
                    if repeat["mode"] == "unique" and used > 0:
                        state.conflicts.append(
                            {
                                "code": "pins_repeat",
                                "message": f"Блюдо «{recipe['name']}» закреплено несколько раз, а выбран режим «Разные блюда каждый день».",
                                "suggestion": "Снимите одно из закреплений или включите режим «Повторы разрешены».",
                            }
                        )
                    batch = self.new_batch(state, recipe["id"], method["id"], date, slot)
                    self.add_item(state, meal, batch, pin_people, day, True, True, pin["portions"])
                    people = [m for m in people if m["id"] not in pin["portions"]]

                if people and repeat["mode"] == "batch" and slot in repeat["batch_slots"]:
                    active = state.active_batch.get(slot)
                    same_group = active is not None and ",".join(active["member_ids"]) == ",".join(m["id"] for m in people)
                    if (
                        active is not None
                        and day <= active["until_day"]
                        and same_group
                        and not (container and not self.catalog.recipes[active["batch"]["recipe_id"]]["container_ok"])
                    ):
                        self.add_item(state, meal, active["batch"], people, day, False, False, None)
                        people = []

                if people:
                    candidates = self.candidates_for(state, people, day, slot, container)
                    best = self.pick_best(state, candidates, people, day, slot, container, rng, cost_weight, budget_per_meal)
                    if best is not None:
                        method = self.kitchen(best[0], slot, container, self.is_weekend(day))["method"]
                        batch = self.new_batch(state, best[0], method["id"] if method else "", date, slot)
                        self.add_item(state, meal, batch, people, day, False, True, None)
                        state.score += best[1]
                        if repeat["mode"] == "batch" and slot in repeat["batch_slots"]:
                            state.active_batch[slot] = {"batch": batch, "until_day": self.batch_until(day), "member_ids": [m["id"] for m in people]}
                    elif len(people) > 1:
                        split: list[str] = []
                        for m in people:
                            own = self.candidates_for(state, [m], day, slot, container)
                            pick = self.pick_best(state, own, [m], day, slot, container, rng, cost_weight, budget_per_meal)
                            if pick is not None:
                                method = self.kitchen(pick[0], slot, container, self.is_weekend(day))["method"]
                                batch = self.new_batch(state, pick[0], method["id"] if method else "", date, slot)
                                self.add_item(state, meal, batch, [m], day, False, True, None)
                                state.score += pick[1]
                                split.append(m["name"])
                            else:
                                code, message = self.explain_empty(state, [m], day, slot, container)
                                state.unfilled.append({"date": date, "slot": slot, "member_ids": [m["id"]], "code": code, "message": message})
                        if split:
                            state.warnings.append(
                                f"{date}, {self.slot_ref(slot)['name']}: общего блюда для всех нет, подобраны отдельные блюда ({', '.join(split)})."
                            )
                    else:
                        code, message = self.explain_empty(state, people, day, slot, container)
                        state.unfilled.append({"date": date, "slot": slot, "member_ids": [m["id"] for m in people], "code": code, "message": message})
                state.meals.append(meal)

        if any(u["code"] == "repeat_exhausted" for u in state.unfilled):
            unique = repeat["mode"] == "unique"
            state.conflicts.append(
                {
                    "code": "unique_mode_catalog_too_small" if unique else "repeat_limit_too_strict",
                    "message": "Подходящих рецептов не хватает, чтобы не повторять блюда весь период."
                    if unique
                    else "Ограничения на повторы не позволяют заполнить все приёмы пищи.",
                    "suggestion": "Выберите «Повторы разрешены», сократите период или ослабьте мягкие условия (время, технику, уровень)."
                    if unique
                    else "Увеличьте допустимое число повторов или уменьшите интервал между ними.",
                }
            )
        if repeat["mode"] == "batch":
            batches = {b["id"]: b for b in state.batches}
            if any(batches[i["batch_id"]]["cook_date"] != m["date"] for m in state.meals for i in m["items"]):
                state.warnings.append(
                    "Блюда из партии едят в другие дни: сроки хранения рецептов не проверены, ориентируйтесь на собственные правила хранения."
                )
        return state


def rank_candidates(req: JSON, catalog: Catalog, menu: JSON, date: str, slot: str, people: list[JSON], exclude_item_id: str | None) -> list[JSON]:
    planner = _Planner(req, catalog)
    state = planner.empty_state()
    if date not in planner.dates:
        raise EngineError("meal_not_found", "Дата вне периода меню.")
    day = planner.dates.index(date)
    batches = {b["id"]: b for b in menu["batches"]}
    counted: set[str] = set()
    for meal in menu["meals"]:
        d = planner.dates.index(meal["date"]) if meal["date"] in planner.dates else -1
        for item in meal["items"]:
            if item["id"] == exclude_item_id:
                continue
            batch = batches.get(item["batch_id"])
            if batch is None or batch["recipe_id"] not in catalog.recipes:
                continue
            rid = batch["recipe_id"]
            if batch["id"] not in counted:
                counted.add(batch["id"])
                state.uses[rid] = state.uses.get(rid, 0) + 1
                for pid in planner.recipe_products.get(rid, []):
                    state.products.add(pid)
            last = state.last_day.get(rid)
            if last is None or d > last:
                state.last_day[rid] = d
            state.categories_by_day.setdefault(d, set()).add(catalog.recipes[rid]["category"])
            serving = planner.per_serving(rid)
            for member_id in sorted(item["portions"].keys()):
                have = state.vit_have.get(member_id)
                if have is None:
                    continue
                for vit in VITAMIN_IDS:
                    amount = serving[vit]
                    if amount["complete"]:
                        have[vit] = have.get(vit, 0) + amount["value"] * item["portions"][member_id]
    people_ids = {p["id"] for p in people}
    participants = [m for m in req["members"] if m["id"] in people_ids]
    weekday = iso_weekday(date)
    container = slot == "lunch" and weekday in req["settings"]["container_days"]
    limit = req["settings"]["budget"]["limit_kop"]
    budget_per_meal = limit / (req["days"] * len(req["slots"])) if limit is not None else 0
    ranked: list[JSON] = []
    for rid in planner.candidates_for(state, participants, day, slot, container):
        method = planner.kitchen(rid, slot, container, planner.is_weekend(day))["method"]
        if method is None:
            continue
        ranked.append(
            {
                "recipe_id": rid,
                "method_id": method["id"],
                "score": planner.score(state, rid, participants, day, slot, container, 0.75 if limit is not None else 0, budget_per_meal),
            }
        )
    ranked.sort(key=lambda c: (-c["score"], c["recipe_id"]))
    return ranked


def _attempts_for(days: int) -> int:
    if days <= 7:
        return 6
    if days <= 14:
        return 4
    return 3


def menu_violations(menu: JSON, catalog: Catalog, members: list[JSON]) -> list[str]:
    by_id = {m["id"]: m for m in members}
    batches = {b["id"]: b for b in menu["batches"]}
    errors: list[str] = []
    for meal in menu["meals"]:
        for item in meal["items"]:
            batch = batches.get(item["batch_id"])
            recipe = catalog.recipes.get(batch["recipe_id"]) if batch else None
            if batch is None or recipe is None:
                errors.append(f"{meal['date']}: блюдо ссылается на неизвестный рецепт.")
                continue
            for member_id in item["portions"]:
                member = by_id.get(member_id)
                if member is None:
                    errors.append(f"{meal['date']}: порция для неизвестного участника.")
                    continue
                if recipe_violations(catalog, recipe, effective_restrictions(catalog, member)):
                    errors.append(f"{meal['date']}: «{recipe['name']}» нарушает запреты участника «{member['name']}».")
                elif recipe_spice(recipe) > spice_tolerance(member):
                    errors.append(f"{meal['date']}: «{recipe['name']}» острее, чем допускает участник «{member['name']}».")
    for batch in menu["batches"]:
        eaten: float = 0
        for meal in menu["meals"]:
            for item in meal["items"]:
                if item["batch_id"] == batch["id"]:
                    for v in item["portions"].values():
                        eaten += v
        if eaten > batch["portions"] + 1e-9:
            errors.append(f"Сумма порций превышает объём партии {batch['id']}.")
    return errors


def _assemble(req: JSON, catalog: Catalog, state: _State, evaluated: int, attempts: int, status: str) -> JSON:
    snapshot: JSON = {"recipes": {}, "products": {}}
    for b in state.batches:
        add_to_snapshot(snapshot, catalog, b["recipe_id"])
    return {
        "format": "foodo-menu",
        "format_version": 1,
        "start_date": req["start_date"],
        "days": req["days"],
        "seed": req["seed"],
        "revision": 1,
        "slots": list(req["slots"]),
        "member_ids": [m["id"] for m in req["members"]],
        "settings": copy.deepcopy(req["settings"]),
        "batches": [dict(b) for b in state.batches],
        "meals": [{**m, "items": [{**i, "portions": dict(i["portions"])} for i in m["items"]]} for m in state.meals],
        "unfilled": list(state.unfilled),
        "conflicts": list(state.conflicts),
        "warnings": list(state.warnings),
        "snapshot": snapshot,
        "stats": {"attempts": attempts, "evaluated": evaluated, "score": state.score, "budget_status": status},
    }


def generate_menu(req: JSON, catalog: Catalog) -> JSON:
    validate_plan_request(req, catalog)
    planner = _Planner(req, catalog)
    rng = Rng(req["seed"])
    attempts = _attempts_for(req["days"])
    budget = req["settings"]["budget"]["limit_kop"] is not None
    best: tuple[_State, float, str] | None = None
    for a in range(attempts):
        cost_weight = a * 0.75 if budget else 0
        state = planner.build(rng, cost_weight)
        status = "none"
        if budget:
            draft = _assemble(req, catalog, state, planner.evaluated, a + 1, "none")
            status = compute_shopping(draft, catalog, req.get("pantry") or [], req.get("prices"), empty_shopping_state())["budget"]["status"]
        objective = state.score - SCORE["unfilledPenalty"] * len(state.unfilled) - (SCORE["budgetExceededPenalty"] if status == "exceeded" else 0)
        if best is None or objective > best[1]:
            best = (state, objective, status)
    assert best is not None
    chosen_state, _, chosen_status = best
    menu = _assemble(req, catalog, chosen_state, planner.evaluated, attempts, chosen_status)
    if chosen_status == "exceeded":
        menu["conflicts"].append(
            {
                "code": "budget_exceeded",
                "message": "В пределах текущего поиска и известных цен не найдено меню, укладывающееся в бюджет.",
                "suggestion": "Увеличьте лимит, добавьте остатки дома, разрешите повторы или выберите более простые блюда.",
            }
        )
    violations = menu_violations(menu, catalog, req["members"])
    if violations:
        raise EngineError("internal_violation", "Внутренняя ошибка: меню нарушает ограничения.", {"violations": violations})
    diagnostics: JSON = {}
    for slot in req["slots"]:
        excluded: dict[str, int] = {}
        kitchen_ok = 0
        for rid in planner.recipes:
            check = planner.kitchen(rid, slot, False)
            if not check["reasons"]:
                kitchen_ok += 1
            for r in check["reasons"]:
                excluded[r] = excluded.get(r, 0) + 1
        diagnostics[slot] = {"total": len(planner.recipes), "kitchen_ok": kitchen_ok, "excluded": excluded}
    return {"menu": menu, "diagnostics": diagnostics}
