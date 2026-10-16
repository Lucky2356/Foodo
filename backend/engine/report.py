"""Per-member nutrition report; twin of frontend/src/engine/report.ts."""

from __future__ import annotations

from typing import Any

from .catalog import Catalog, snapshot_catalog
from .nutrition import VITAMIN_IDS, NutritionCache, add_into, new_table, serving_mass_g
from .targets import resolve_vitamin_targets

JSON = dict[str, Any]


def menu_report(menu: JSON, base_catalog: Catalog, members: list[JSON]) -> list[JSON]:
    catalog = snapshot_catalog(menu, base_catalog)
    cache = NutritionCache(catalog)
    batches = {b["id"]: b for b in menu["batches"]}
    tolerance = menu["settings"]["tolerances"]["energy_pct"]
    reports: list[JSON] = []
    for member in members:
        if member["id"] not in menu["member_ids"]:
            continue
        days: list[JSON] = []
        period = new_table()
        dates = sorted({m["date"] for m in menu["meals"]})
        for date in dates:
            totals = new_table()
            mass: float | None = 0
            for meal in menu["meals"]:
                if meal["date"] != date:
                    continue
                for item in meal["items"]:
                    factor = item["portions"].get(member["id"])
                    if factor is None:
                        continue
                    batch = batches.get(item["batch_id"])
                    recipe = catalog.recipes.get(batch["recipe_id"]) if batch else None
                    if batch is None or recipe is None:
                        continue
                    add_into(totals, cache.per_serving(recipe["id"]), factor)
                    serving = serving_mass_g(recipe)
                    mass = None if mass is None or serving is None else mass + serving * factor
            add_into(period, totals, 1)
            target = member.get("kcal_target") if member["portion_mode"] == "target" else None
            deviation = None
            status = "no_target"
            if target:
                deviation = (totals["kcal"]["value"] - target) / target * 100
                status = "ok" if abs(deviation) <= tolerance else ("below" if deviation < 0 else "above")
            days.append(
                {"date": date, "totals": totals, "portion_mass_g": mass, "energy_target": target, "energy_deviation_pct": deviation, "energy_status": status}
            )
        vitamins: list[JSON] = []
        vit_settings = menu["settings"]["vitamins"]
        resolved = resolve_vitamin_targets(catalog, member, vit_settings["target_set"], vit_settings["demo"])
        for vit in VITAMIN_IDS:
            t = next((r for r in resolved if r["nutrient"] == vit), None)
            amount = period[vit]
            daily = t["daily"] if t else None
            row = {
                "nutrient": vit,
                "status": t["status"] if t else "no_target",
                "daily_target": daily,
                "period_target": daily * len(dates) if daily is not None else None,
                "period_value": amount["value"],
                "coverage_pct": None,
                "lower_bound_pct": None,
                "data_complete": amount["complete"],
                "missing_products": sorted(amount["missing"]),
                "message": t["message"] if t else "",
                "set_status": t["setStatus"] if t else None,
            }
            if t and t["status"] == "ok" and row["period_target"]:
                pct = amount["value"] / row["period_target"] * 100
                if amount["complete"]:
                    row["coverage_pct"] = pct
                else:
                    row["lower_bound_pct"] = pct
                    row["status"] = "incomplete_data"
                    row["message"] = "Данные о витамине известны не для всех продуктов: показана нижняя граница."
            vitamins.append(row)
        reports.append({"member_id": member["id"], "name": member["name"], "days": days, "period": period, "vitamins": vitamins})
    return reports
