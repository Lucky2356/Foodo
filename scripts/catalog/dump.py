"""Compact, review-friendly JSON layout used by shared/data (one product per two lines, recipes by blocks)."""
import json


def j(v):
    return json.dumps(v, ensure_ascii=False)


def dump_products(doc):
    head = {k: v for k, v in doc.items() if k != "products"}
    lines = ["{"] + [f"  {j(k)}: {j(v)}," for k, v in head.items()] + ['  "products": [']
    items = []
    for p in doc["products"]:
        rest = {k: v for k, v in p.items() if k != "nutrients"}
        first = j(rest)[:-1]
        items.append(f"    {first},\n     \"nutrients\": {j(p['nutrients'])}}}")
    lines.append(",\n".join(items))
    lines += ["  ]", "}"]
    return "\n".join(lines) + "\n"


def dump_recipes(doc):
    head = {k: v for k, v in doc.items() if k != "recipes"}
    out = ["{"] + [f"  {j(k)}: {j(v)}," for k, v in head.items()] + ['  "recipes": [']
    blocks = []
    for r in doc["recipes"]:
        b = ["    {"]
        b.append(f'      "id": {j(r["id"])}, "version": {j(r["version"])}, "name": {j(r["name"])},')
        b.append(f'      "description": {j(r["description"])},')
        b.append(f'      "category": {j(r["category"])}, "meal_types": {j(r["meal_types"])}, "servings": {j(r["servings"])}, "yield_g": {j(r["yield_g"])},')
        b.append('      "ingredients": [')
        b.append(",\n".join(f"        {j(i)}" for i in r["ingredients"]))
        b.append("      ],")
        b.append('      "methods": [')
        ms = []
        for m in r["methods"]:
            head_m = {k: v for k, v in m.items() if k != "steps"}
            s = f"        {j(head_m)[:-1]}, \"steps\": [\n"
            s += ",\n".join(f"          {j(x)}" for x in m["steps"])
            s += "\n        ]}"
            ms.append(s)
        b.append(",\n".join(ms))
        b.append("      ],")
        b.append(f'      "techniques": {j(r["techniques"])}, "diet_tags": {j(r["diet_tags"])}, "container_ok": {j(r["container_ok"])},')
        tail = {k: v for k, v in r.items() if k not in {"id", "version", "name", "description", "category", "meal_types", "servings", "yield_g", "ingredients", "methods", "techniques", "diet_tags", "container_ok"}}
        b.append("      " + j(tail)[1:-1])
        b.append("    }")
        blocks.append("\n".join(b))
    out.append(",\n".join(blocks))
    out += ["  ]", "}"]
    return "\n".join(out) + "\n"
