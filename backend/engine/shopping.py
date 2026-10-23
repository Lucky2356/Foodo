"""Shopping list, pantry allocation and budget; twin of frontend/src/engine/shopping.ts."""

from __future__ import annotations

import math
from typing import Any

from .basics import clean_qty, round_kop
from .catalog import Catalog, snapshot_catalog
from .units import to_base

JSON = dict[str, Any]

ESTIMATED_PRICE_KINDS = ("rosstat",)


def empty_shopping_state() -> JSON:
    return {"manual_lines": [], "marks": {}, "seen": {}}


def latest_price(prices: JSON | None, product_id: str) -> JSON | None:
    if not prices:
        return None
    best: JSON | None = None
    for e in prices["entries"]:
        if e["product_id"] != product_id:
            continue
        if best is None or e["date"] >= best["date"]:
            best = e
    return best


def unit_price_kop(prices: JSON | None, product: JSON) -> float | None:
    entry = latest_price(prices, product["id"])
    if entry is None:
        return None
    size = to_base(product, entry["package_size"], entry["package_unit"])
    if size is None or size <= 0:
        return None
    return entry["price_kop"] / size


def batch_needs(menu: JSON, catalog: Catalog, only_batch_id: str | None = None) -> list[JSON]:
    order = sorted(enumerate(menu["batches"]), key=lambda x: (x[1]["cook_date"], x[0]))
    needs: list[JSON] = []
    for _, b in order:
        if only_batch_id is not None and b["id"] != only_batch_id:
            continue
        recipe = catalog.recipes.get(b["recipe_id"])
        if recipe is None or b["portions"] <= 0:
            continue
        scale = b["portions"] / recipe["servings"]
        for ing in recipe["ingredients"]:
            product = catalog.products.get(ing["product"])
            if product is None or product.get("purchasable") is False:
                continue
            base = to_base(product, ing["qty"] * scale, ing["unit"])
            if base is not None:
                needs.append(
                    {
                        "key": f"{product['id']}:{product['base_unit']}",
                        "product": product,
                        "unit": product["base_unit"],
                        "convertible": True,
                        "qty": base,
                        "batch_id": b["id"],
                        "recipe": recipe,
                        "cook_date": b["cook_date"],
                    }
                )
            else:
                needs.append(
                    {
                        "key": f"{product['id']}:{ing['unit']}",
                        "product": product,
                        "unit": ing["unit"],
                        "convertible": False,
                        "qty": ing["qty"] * scale,
                        "batch_id": b["id"],
                        "recipe": recipe,
                        "cook_date": b["cook_date"],
                    }
                )
    return needs


def _pantry_lots(catalog: Catalog, pantry: list[JSON], reserved: dict[str, float] | None = None) -> dict[str, list[JSON]]:
    # reserved: base quantities per product taken off the end of its lots (twin of pantryLots in shopping.ts).
    lots: dict[str, list[JSON]] = {}
    for item in pantry:
        product = catalog.products.get(item["product_id"])
        if product is None or item["qty"] <= 0:
            continue
        qty = to_base(product, item["qty"], item["unit"])
        if qty is None:
            continue
        lots.setdefault(item["product_id"], []).append({"item": item, "remaining": qty})
    for lst in lots.values():
        lst.sort(key=lambda lot: (lot["item"]["expires"] is None, lot["item"]["expires"] or "", lot["item"]["id"]))
    for product_id, qty in (reserved or {}).items():
        left = qty
        for lot in reversed(lots.get(product_id, [])):
            if left <= 1e-9:
                break
            take = min(lot["remaining"], left)
            lot["remaining"] -= take
            left -= take
    return lots


def allocate_pantry(
    catalog: Catalog, needs: list[JSON], pantry: list[JSON], reserved: dict[str, float] | None = None
) -> tuple[list[float], list[JSON], list[JSON]]:
    lots = _pantry_lots(catalog, pantry, reserved)
    covered: list[float] = []
    allocations: list[JSON] = []
    expired: list[JSON] = []
    expired_seen: set[str] = set()
    for need in needs:
        remaining = need["qty"]
        got = 0.0
        if need["convertible"]:
            for lot in lots.get(need["product"]["id"], []):
                if remaining <= 1e-9:
                    break
                if lot["remaining"] <= 1e-9:
                    continue
                expires = lot["item"]["expires"]
                if expires is not None and expires < need["cook_date"]:
                    if lot["item"]["id"] not in expired_seen:
                        expired_seen.add(lot["item"]["id"])
                        expired.append(
                            {"pantry_id": lot["item"]["id"], "product_id": need["product"]["id"], "expires": expires, "needed_on": need["cook_date"]}
                        )
                    continue
                take = min(lot["remaining"], remaining)
                lot["remaining"] -= take
                remaining -= take
                got += take
                allocations.append({"pantry_id": lot["item"]["id"], "batch_id": need["batch_id"], "product_id": need["product"]["id"], "qty": clean_qty(take)})
        covered.append(got)
    return covered, allocations, expired


def _department_index(catalog: Catalog, department: str) -> int:
    departments = catalog.reference["departments"]
    return departments.index(department) if department in departments else len(departments)


def compute_shopping(
    menu: JSON,
    base_catalog: Catalog,
    pantry: list[JSON],
    prices: JSON | None,
    state: JSON,
    budget: JSON | None = None,
    transferred: dict[str, float] | None = None,
    cooked: list[str] | None = None,
) -> JSON:
    """budget: the household's current {"limit_kop": ...}; the menu's saved budget is used when it is None.
    transferred: base quantities per product bought for this menu and already moved to the pantry."""
    catalog = snapshot_catalog(menu, base_catalog)
    done = set(cooked or [])
    # Cooked batches had their products deducted from the pantry: there is nothing left to buy for them.
    needs = [n for n in batch_needs(menu, catalog) if n["batch_id"] not in done]
    covered, allocations, expired = allocate_pantry(catalog, needs, pantry, transferred)

    by_key: dict[str, JSON] = {}
    keys: list[str] = []
    for index, need in enumerate(needs):
        line = by_key.get(need["key"])
        if line is None:
            line = {
                "id": f"auto:{need['key']}",
                "product_id": need["product"]["id"],
                "name": need["product"]["name"],
                "department": need["product"]["department"],
                "unit": need["unit"],
                "convertible": need["convertible"],
                "needed": 0,
                "from_pantry": 0,
                "to_buy": 0,
                "buy_qty": 0,
                "package": None,
                "package_note": None,
                "price_kop": None,
                "price_per": None,
                "price_date": None,
                "price_source": None,
                "price_kind": None,
                "estimated": False,
                "purchase_cost_kop": None,
                "usage_cost_kop": None,
                "sources": [],
                "purchased": False,
                "at_home": False,
                "previous_to_buy": None,
                "changed": False,
            }
            by_key[need["key"]] = line
            keys.append(need["key"])
        line["needed"] += need["qty"]
        line["from_pantry"] += covered[index]
        line["sources"].append(
            {
                "batch_id": need["batch_id"],
                "recipe_id": need["recipe"]["id"],
                "recipe_name": need["recipe"]["name"],
                "cook_date": need["cook_date"],
                "qty": clean_qty(need["qty"]),
            }
        )

    missing: list[str] = []
    estimated = False
    purchase_kop = 0
    usage_kop = 0
    lines: list[JSON] = []
    for key in keys:
        line = by_key[key]
        product = catalog.products[line["product_id"]]
        line["needed"] = clean_qty(line["needed"])
        line["from_pantry"] = clean_qty(line["from_pantry"])
        line["to_buy"] = clean_qty(max(0, line["needed"] - line["from_pantry"]))
        mark = state["marks"].get(line["id"], {})
        line["purchased"] = bool(mark.get("purchased"))
        line["at_home"] = bool(mark.get("at_home"))
        seen = state["seen"].get(line["id"])
        line["previous_to_buy"] = seen
        line["changed"] = seen is not None and abs(seen - line["to_buy"]) > 1e-6
        effective = 0 if line["at_home"] else line["to_buy"]
        line["buy_qty"] = effective

        entry = latest_price(prices, product["id"])
        pkg = {"size": entry["package_size"], "unit": entry["package_unit"]} if entry else product.get("package")
        if line["convertible"] and pkg:
            size_base = to_base(product, pkg["size"], pkg["unit"])
            if size_base is not None and size_base > 0:
                # A price per kilogram (Rosstat averages) still buys the product in its usual package when
                # it has one; only a product without a package is bought by weight.
                loose = bool(entry and entry.get("loose"))
                own = product.get("package") if loose else None
                own_base = to_base(product, own["size"], own["unit"]) if own else None
                if not loose:
                    buy_pkg: JSON | None = {"size": pkg["size"], "unit": pkg["unit"], "base": size_base}
                elif own and own_base is not None and own_base > 0:
                    buy_pkg = {"size": own["size"], "unit": own["unit"], "base": own_base}
                else:
                    buy_pkg = None
                count = math.ceil(effective / buy_pkg["base"] - 1e-9) if buy_pkg and effective > 0 else 0
                line["package"] = {"size": buy_pkg["size"], "unit": buy_pkg["unit"], "count": count} if buy_pkg else None
                if buy_pkg:
                    line["buy_qty"] = clean_qty(count * buy_pkg["base"])
                if entry:
                    kind = entry.get("kind") or "manual"
                    line["price_kop"] = entry["price_kop"]
                    line["price_per"] = {"size": entry["package_size"], "unit": entry["package_unit"], "loose": loose}
                    line["price_date"] = entry["date"]
                    line["price_source"] = entry["source"]
                    line["price_kind"] = kind
                    line["estimated"] = kind in ESTIMATED_PRICE_KINDS
                    if not loose:
                        line["purchase_cost_kop"] = count * entry["price_kop"]
                    elif buy_pkg:
                        line["purchase_cost_kop"] = round_kop(count * buy_pkg["base"] * entry["price_kop"] / size_base)
                    else:
                        line["purchase_cost_kop"] = round_kop(effective * entry["price_kop"] / size_base)
                    line["usage_cost_kop"] = round_kop(line["needed"] * entry["price_kop"] / size_base)
            else:
                line["package_note"] = "Нет коэффициента для перевода упаковки в единицы рецепта"
        elif not line["convertible"]:
            line["package_note"] = "Количество не переведено: для продукта нет нужного коэффициента"
        if line["purchase_cost_kop"] is not None:
            purchase_kop += line["purchase_cost_kop"]
        if line["estimated"] and effective > 0:
            estimated = True
        if line["usage_cost_kop"] is not None:
            usage_kop += line["usage_cost_kop"]
        if effective > 0 and line["purchase_cost_kop"] is None:
            missing.append(line["id"])
        lines.append(line)

    manual = []
    for m in state["manual_lines"]:
        mark = state["marks"].get(m["id"], {})
        manual.append({**m, "purchased": bool(mark.get("purchased")), "at_home": bool(mark.get("at_home"))})
    for m in manual:
        if m["at_home"]:
            continue
        if m["price_kop"] is None:
            missing.append(m["id"])
        else:
            purchase_kop += m["price_kop"]

    lines.sort(key=lambda ln: (_department_index(catalog, ln["department"]), ln["name"], ln["id"]))

    limit = budget["limit_kop"] if budget is not None else menu["settings"]["budget"]["limit_kop"]
    status = "none"
    if limit is not None:
        # Known prices alone already over the limit is an overrun, whatever the missing prices add.
        status = "exceeded" if purchase_kop > limit else ("unconfirmed" if missing else "ok")
    return {
        "lines": lines,
        "manual_lines": manual,
        "totals": {"purchase_kop": purchase_kop, "usage_kop": usage_kop, "complete": not missing, "estimated": estimated, "missing_prices": missing},
        "budget": {
            "limit_kop": limit,
            "purchase_kop": purchase_kop,
            "diff_kop": None if limit is None else limit - purchase_kop,
            "status": status,
            "estimated": estimated,
        },
        "allocations": allocations,
        "expired_skipped": expired,
    }


def pantry_after_cooking(menu: JSON, base_catalog: Catalog, pantry: list[JSON], batch_id: str) -> tuple[list[JSON], list[JSON]]:
    catalog = snapshot_catalog(menu, base_catalog)
    needs = batch_needs(menu, catalog, batch_id)
    _, allocations, _ = allocate_pantry(catalog, needs, pantry)
    used: dict[str, float] = {}
    for a in allocations:
        used[a["pantry_id"]] = used.get(a["pantry_id"], 0) + a["qty"]
    result: list[JSON] = []
    for item in pantry:
        take = used.get(item["id"])
        if take is None:
            result.append(item)
            continue
        product = catalog.products.get(item["product_id"])
        base = to_base(product, item["qty"], item["unit"]) if product else None
        if base is None or product is None:
            result.append(item)
            continue
        left = clean_qty(base - take)
        if left > 1e-6:
            result.append({**item, "qty": left, "unit": product["base_unit"]})
    return result, allocations
