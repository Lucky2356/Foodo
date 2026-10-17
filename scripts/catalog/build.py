"""Builds the starter catalog in shared/data from reviewable text sources (docs/CATALOG.md).

    python -m scripts.catalog.build          # validate the sources and write shared/data
    python -m scripts.catalog.build --check  # validate only, write nothing

Sources in scripts/catalog/sources:
  products_*.txt  — new products, one per line;
  recipes_*.txt   — new recipes in blocks;
  tags_*.txt      — cuisine / spiciness / kid-friendliness for recipes already in recipes.json.

The build is idempotent: a product or recipe defined in the sources replaces the entry with the same
id, so running it twice gives the same files. Nothing in the sources is executed; it is parsed text.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

from .dump import dump_products, dump_recipes

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "shared" / "data"
SOURCES = Path(__file__).resolve().parent / "sources"

NUTRIENTS = [
    "kcal",
    "protein",
    "fat",
    "carbs",
    "fiber",
    "vit_a",
    "vit_c",
    "vit_d",
    "vit_e",
    "vit_b6",
    "vit_b12",
    "folate",
]
RECIPE_UNITS = {"g", "ml", "pcs", "tbsp", "tsp", "pinch"}
STATES = {"raw", "dry", "cooked", "processed"}
BASE_UNITS = {"g", "ml", "pcs"}
ID = re.compile(r"[a-z0-9]+(?:[-_][a-z0-9]+)*")
RECIPE_SOURCE = "foodo-recipes-2026-10"
PRODUCT_SOURCE = "foodo-estimate-2026-10"

JSON = dict[str, Any]


class SourceError(Exception):
    pass


def _num(text: str, where: str) -> float:
    try:
        return float(text.replace(",", "."))
    except ValueError as exc:
        raise SourceError(f"{where}: not a number: {text!r}") from exc


def _int_or_float(v: float) -> int | float:
    return int(v) if float(v).is_integer() else v


def parse_products(path: Path) -> list[JSON]:
    """`id | Название | category | Отдел | state | base_unit | edible | 12 nutrients | extras`.

    Nutrients per 100 g of the edible part in the order of NUTRIENTS; `N` means unknown (not zero).
    Extras, separated by «;»: piece=40; dens=1.03; spoon=tbsp:15,tsp:5,pinch:0.5; pkg=500 g;
    allergens=gluten,milk; contains=wheat_flour; known=0; purchasable=0.
    """
    out = []
    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        where = f"{path.name}:{n}"
        f = [x.strip() for x in line.split("|")]
        if len(f) not in (8, 9):
            raise SourceError(f"{where}: expected 8 or 9 fields, got {len(f)}")
        pid, name, cat, dept, state, unit, edible, nuts = f[:8]
        extras = f[8] if len(f) == 9 else ""
        values = nuts.split()
        if len(values) != len(NUTRIENTS):
            raise SourceError(
                f"{where}: {len(values)} nutrient values, expected {len(NUTRIENTS)}"
            )
        p: JSON = {
            "id": pid,
            "name": name,
            "category": cat,
            "department": dept,
            "state": state,
            "base_unit": unit,
            "edible_fraction": _int_or_float(_num(edible, where)),
        }
        allergens: list[str] = []
        contains: list[str] = []
        known = True
        purchasable = True
        for part in [x.strip() for x in extras.split(";") if x.strip()]:
            key, _, val = part.partition("=")
            key, val = key.strip(), val.strip()
            if key == "piece":
                p["piece_g"] = _int_or_float(_num(val, where))
            elif key == "dens":
                p["density_g_ml"] = _int_or_float(_num(val, where))
            elif key == "spoon":
                spoon = {}
                for item in val.split(","):
                    k, _, v = item.partition(":")
                    spoon[k.strip()] = _int_or_float(_num(v, where))
                p["spoon_g"] = spoon
            elif key == "pkg":
                size, _, pu = val.partition(" ")
                p["package"] = {
                    "size": _int_or_float(_num(size, where)),
                    "unit": pu.strip(),
                }
            elif key == "allergens":
                allergens = [x.strip() for x in val.split(",") if x.strip()]
            elif key == "contains":
                contains = [x.strip() for x in val.split(",") if x.strip()]
            elif key == "known":
                known = val == "1"
            elif key == "purchasable":
                purchasable = val == "1"
            else:
                raise SourceError(f"{where}: unknown extra {key!r}")
        p["allergens"] = allergens
        p["contains"] = contains
        p["composition_known"] = known
        if not purchasable:
            p["purchasable"] = False
        p["source"] = PRODUCT_SOURCE
        p["nutrients"] = {
            k: (None if v in ("N", "None") else _int_or_float(_num(v, where)))
            for k, v in zip(NUTRIENTS, values)
        }
        p["_where"] = where
        out.append(p)
    return out


def parse_recipes(path: Path) -> list[JSON]:
    """Blocks:

    @ id | Название | category | meal types | servings | yield_g | techniques | diet tags | container 0/1 | cuisine | spicy 0-2 | kid 0/1
    Описание одной строкой.
    - product_id qty unit
    # method_id | Название способа | equipment ids or - | active_min | total_min
    1. Шаг.
    ! Совет (необязательно).
    """
    out: list[JSON] = []
    cur: JSON | None = None
    method: JSON | None = None
    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        where = f"{path.name}:{n}"
        if not line or line.startswith("//"):
            continue
        if line.startswith("@"):
            f = [x.strip() for x in line[1:].split("|")]
            if len(f) != 12:
                raise SourceError(
                    f"{where}: recipe header needs 12 fields, got {len(f)}"
                )
            cur = {
                "id": f[0],
                "version": 1,
                "name": f[1],
                "description": "",
                "category": f[2],
                "meal_types": f[3].split(),
                "servings": int(_num(f[4], where)),
                "yield_g": None if f[5] == "-" else int(_num(f[5], where)),
                "ingredients": [],
                "methods": [],
                "techniques": f[6].split(),
                "diet_tags": [] if f[7] == "-" else f[7].split(),
                "container_ok": f[8] == "1",
                "tip": None,
                "storage": None,
                "image": None,
                "source": RECIPE_SOURCE,
                "cuisine": f[9],
                "spicy": int(_num(f[10], where)),
                "kid_friendly": f[11] == "1",
                "_where": where,
            }
            out.append(cur)
            method = None
            continue
        if cur is None:
            raise SourceError(f"{where}: text before the first recipe header")
        if line.startswith("- "):
            parts = line[2:].split()
            if len(parts) != 3:
                raise SourceError(f"{where}: ingredient must be «product qty unit»")
            q = _num(parts[1], where)
            cur["ingredients"].append(
                {"product": parts[0], "qty": _int_or_float(q), "unit": parts[2]}
            )
        elif line.startswith("#"):
            f = [x.strip() for x in line[1:].split("|")]
            if len(f) != 5:
                raise SourceError(f"{where}: method header needs 5 fields")
            method = {
                "id": f[0],
                "name": f[1],
                "equipment": [] if f[2] == "-" else f[2].split(),
                "active_min": int(_num(f[3], where)),
                "total_min": int(_num(f[4], where)),
                "steps": [],
            }
            cur["methods"].append(method)
        elif re.match(r"^\d+\.\s", line):
            if method is None:
                raise SourceError(f"{where}: step before a method header")
            method["steps"].append(re.sub(r"^\d+\.\s+", "", line))
        elif line.startswith("!"):
            cur["tip"] = line[1:].strip()
        else:
            if cur["description"]:
                raise SourceError(f"{where}: second description line for {cur['id']}")
            cur["description"] = line
    return out


def parse_tags(path: Path) -> list[tuple[str, str, int, bool, str]]:
    """`recipe-id | cuisine | spicy 0-2 | kid 0/1` for recipes that are already in recipes.json."""
    out = []
    for n, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        f = [x.strip() for x in line.split("|")]
        if len(f) != 4:
            raise SourceError(f"{path.name}:{n}: expected 4 fields")
        out.append(
            (f[0], f[1], int(_num(f[2], path.name)), f[3] == "1", f"{path.name}:{n}")
        )
    return out


def grams(p: JSON, qty: float, unit: str) -> float | None:
    if unit == "g":
        return qty
    if unit == "ml":
        return qty * p["density_g_ml"] if p.get("density_g_ml") else None
    if unit == "pcs":
        return qty * p["piece_g"] if p.get("piece_g") else None
    spoon = (p.get("spoon_g") or {}).get(unit)
    return qty * spoon if spoon else None


def convertible(p: JSON, qty: float, unit: str) -> bool:
    """The unit must convert to the product's base unit (the engine rule, docs/NUTRITION_RULES.md)."""
    if unit == p["base_unit"]:
        return True
    g = grams(p, qty, unit)
    if g is None:
        return False
    if p["base_unit"] == "g":
        return True
    if p["base_unit"] == "ml":
        return bool(p.get("density_g_ml"))
    return bool(p.get("piece_g"))


def validate(
    ref: JSON,
    products: dict[str, JSON],
    recipes: list[JSON],
    new_products: list[JSON],
    new_recipes: list[JSON],
    tags: list[Any],
) -> list[str]:
    errors: list[str] = []
    cats = {c["id"] for c in ref["categories"]}
    allergens = {a["id"] for a in ref["allergens"]}
    depts = set(ref["departments"])
    for p in new_products:
        w = p["_where"]
        if not ID.fullmatch(p["id"]):
            errors.append(f"{w}: bad product id {p['id']}")
        if p["category"] not in cats:
            errors.append(f"{w}: unknown category {p['category']}")
        if p["department"] not in depts:
            errors.append(f"{w}: unknown department {p['department']}")
        if p["state"] not in STATES or p["base_unit"] not in BASE_UNITS:
            errors.append(f"{w}: state/base unit")
        if not 0 < p["edible_fraction"] <= 1:
            errors.append(f"{w}: edible fraction")
        for a in p["allergens"]:
            if a not in allergens:
                errors.append(f"{w}: unknown allergen {a}")
        for c in p["contains"]:
            if c not in products:
                errors.append(f"{w}: contains unknown product {c}")
        if p["base_unit"] == "pcs" and not p.get("piece_g"):
            errors.append(f"{w}: pcs product needs piece=")
        if p["base_unit"] == "ml" and not p.get("density_g_ml"):
            errors.append(f"{w}: ml product needs dens=")
        n = p["nutrients"]
        macro = [n["protein"], n["fat"], n["carbs"]]
        if n["kcal"] is not None and all(v is not None for v in macro):
            atwater = 4 * macro[0] + 9 * macro[1] + 4 * macro[2]
            # Source energy is stored as given, but a gross mismatch means a typo.
            if abs(atwater - n["kcal"]) > max(40, 0.25 * n["kcal"]):
                errors.append(
                    f"{w}: kcal {n['kcal']} far from 4/9/4 estimate {atwater:.0f}"
                )
    techniques = {t["id"] for t in ref["techniques"]}
    equipment = {e["id"] for e in ref["equipment"]}
    diet_tags = {t["id"] for t in ref["diet_tags"]}
    slots = {s["id"] for s in ref["meal_slots"]}
    rcats = {c["id"] for c in ref["recipe_categories"]}
    cuisines = {c["id"] for c in ref.get("cuisines", [])}
    names: dict[str, str] = {}
    for r in recipes:
        names.setdefault(r["name"].lower(), r["id"])
    for r in new_recipes:
        w = r["_where"]
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", r["id"]):
            errors.append(f"{w}: bad recipe id {r['id']}")
        other = names.get(r["name"].lower())
        if other and other != r["id"]:
            errors.append(f"{w}: name «{r['name']}» already used by {other}")
        names[r["name"].lower()] = r["id"]
        if r["category"] not in rcats:
            errors.append(f"{w}: recipe category {r['category']}")
        if not r["meal_types"] or not set(r["meal_types"]) <= slots:
            errors.append(f"{w}: meal types {r['meal_types']}")
        for t in r["techniques"]:
            if t not in techniques:
                errors.append(f"{w}: technique {t}")
        for t in r["diet_tags"]:
            if t not in diet_tags:
                errors.append(f"{w}: diet tag {t}")
        if r["cuisine"] not in cuisines:
            errors.append(f"{w}: cuisine {r['cuisine']}")
        if r["spicy"] not in (0, 1, 2):
            errors.append(f"{w}: spicy must be 0, 1 or 2")
        if not r["description"] or len(r["description"]) > 300:
            errors.append(f"{w}: description missing or too long")
        if r["servings"] < 1 or r["servings"] > 20:
            errors.append(f"{w}: servings")
        if len(r["ingredients"]) < 2:
            errors.append(f"{w}: fewer than 2 ingredients")
        seen: set[str] = set()
        for ing in r["ingredients"]:
            p = products.get(ing["product"])
            if p is None:
                errors.append(f"{w}: unknown product {ing['product']}")
                continue
            if ing["product"] in seen:
                errors.append(f"{w}: product {ing['product']} listed twice")
            seen.add(ing["product"])
            if ing["unit"] not in RECIPE_UNITS:
                errors.append(f"{w}: unit {ing['unit']}")
            elif not ing["qty"] > 0 or not convertible(p, ing["qty"], ing["unit"]):
                errors.append(
                    f"{w}: {ing['product']} {ing['qty']} {ing['unit']} not convertible to {p['base_unit']}"
                )
        if not r["methods"]:
            errors.append(f"{w}: no cooking method")
        mids: set[str] = set()
        for m in r["methods"]:
            if m["id"] in mids:
                errors.append(f"{w}: duplicate method id {m['id']}")
            mids.add(m["id"])
            if not set(m["equipment"]) <= equipment:
                errors.append(f"{w}: equipment {m['equipment']}")
            if (
                not 0 < m["active_min"] <= m["total_min"] <= 24 * 60
                or len(m["steps"]) < 2
            ):
                errors.append(f"{w}: method {m['id']}: times or fewer than 2 steps")
    known = {r["id"] for r in recipes} | {r["id"] for r in new_recipes}
    for rid, cuisine, spicy, _kid, w in tags:
        if rid not in known:
            errors.append(f"{w}: unknown recipe {rid}")
        if cuisine not in cuisines:
            errors.append(f"{w}: cuisine {cuisine}")
        if spicy not in (0, 1, 2):
            errors.append(f"{w}: spicy")
    return errors


def build(write: bool) -> int:
    ref = json.loads((DATA / "reference.json").read_text(encoding="utf-8"))
    prods_doc = json.loads((DATA / "products.json").read_text(encoding="utf-8"))
    recs_doc = json.loads((DATA / "recipes.json").read_text(encoding="utf-8"))
    try:
        new_products = [
            p for f in sorted(SOURCES.glob("products_*.txt")) for p in parse_products(f)
        ]
        new_recipes = [
            r for f in sorted(SOURCES.glob("recipes_*.txt")) for r in parse_recipes(f)
        ]
        tags = [t for f in sorted(SOURCES.glob("tags_*.txt")) for t in parse_tags(f)]
    except SourceError as exc:
        print(exc, file=sys.stderr)
        return 1
    errors: list[str] = []
    for kind, items in (("product", new_products), ("recipe", new_recipes)):
        seen: dict[str, str] = {}
        for x in items:
            if x["id"] in seen:
                errors.append(
                    f"{x['_where']}: {kind} {x['id']} also defined at {seen[x['id']]}"
                )
            seen[x["id"]] = x["_where"]
    products = {p["id"]: p for p in prods_doc["products"]}
    old_recipe_names = {r["id"]: r["name"] for r in recs_doc["recipes"]}
    # Rebuilding replaces a record with the same id and name; a different name under an existing id
    # means a source would silently overwrite another dish or product.
    for kind, items, existing in (
        ("product", new_products, {i: x["name"] for i, x in products.items()}),
        ("recipe", new_recipes, old_recipe_names),
    ):
        for x in items:
            if x["id"] in existing and existing[x["id"]] != x["name"]:
                errors.append(
                    f"{x['_where']}: {kind} id {x['id']} is already «{existing[x['id']]}»"
                )
    for p in new_products:
        products[p["id"]] = p
    product_names: dict[str, str] = {}
    for p in products.values():
        other = product_names.setdefault(p["name"].lower(), p["id"])
        if other != p["id"]:
            errors.append(
                f"{p.get('_where', p['id'])}: product name «{p['name']}» already used by {other}"
            )
    new_ids = {r["id"] for r in new_recipes}
    old_recipes = [r for r in recs_doc["recipes"] if r["id"] not in new_ids]
    errors += validate(ref, products, old_recipes, new_products, new_recipes, tags)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        print(f"{len(errors)} error(s)", file=sys.stderr)
        return 1
    for x in (*new_products, *new_recipes):
        x.pop("_where", None)
    by_id = {r["id"]: r for r in old_recipes}
    for rid, cuisine, spicy, kid, _w in tags:
        if rid in by_id:
            r = by_id[rid]
            r["cuisine"], r["spicy"], r["kid_friendly"] = cuisine, spicy, kid
    order = [p["id"] for p in prods_doc["products"]]
    order += [p["id"] for p in new_products if p["id"] not in set(order)]
    prods_doc["products"] = [products[i] for i in order]
    # Existing recipes keep their position; source recipes are appended in source order.
    recs_doc["recipes"] = old_recipes + new_recipes
    print(
        f"products: {len(prods_doc['products'])}, recipes: {len(recs_doc['recipes'])} ({len(new_recipes)} from sources)"
    )
    if write:
        (DATA / "products.json").write_text(dump_products(prods_doc), encoding="utf-8")
        (DATA / "recipes.json").write_text(dump_recipes(recs_doc), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(build(write="--check" not in sys.argv[1:]))
