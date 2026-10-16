"""Turns shared/data/prices/*.json into the static files the guest-mode site reads.

    python -m scripts.prices.publish frontend/public/data/prices

Layout (see frontend/src/data/prices.ts): index.json maps «region:<region>», «city:<city id>» and
«<city id>:<chain id>» to small files with price entries, so a browser downloads only its own
city's prices and sends nothing but the file name."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "shared" / "data" / "prices"


def entry(o: dict[str, Any], kind: str) -> dict[str, Any]:
    return {
        "product_id": o["product_id"],
        "price_kop": o["price_kop"],
        "package_size": o["package_size"],
        "package_unit": o["package_unit"],
        "currency": "RUB",
        "date": o["observed_on"],
        "source": o.get("source", ""),
        "kind": kind,
        "loose": bool(o.get("loose", False)),
    }


def slug(key: str) -> str:
    return hashlib.sha1(key.encode()).hexdigest()[:12]


def build(source: Path = SOURCE) -> dict[str, dict[str, Any]]:
    """{relative file path: JSON payload}, including index.json."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for path in sorted(source.glob("*.json")):
        if path.name == "status.json":
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        kind = doc["kind"]
        for o in doc["observations"]:
            if kind == "rosstat":
                key = (
                    f"city:{o['city_id']}"
                    if o.get("city_id")
                    else f"region:{o['region']}"
                )
            else:
                key = f"{o['city_id']}:{o['chain_id']}"
            groups.setdefault(key, []).append(entry(o, kind))
    files: dict[str, dict[str, Any]] = {}
    index: dict[str, str] = {}
    for key in sorted(groups):
        name = f"{slug(key)}.json"
        index[key] = name
        files[name] = {
            "key": key,
            "entries": sorted(groups[key], key=lambda e: e["product_id"]),
        }
    status_path = source / "status.json"
    status = (
        json.loads(status_path.read_text(encoding="utf-8"))
        if status_path.exists()
        else None
    )
    files["index.json"] = {
        "format": "foodo-public-prices",
        "version": 1,
        "files": index,
        "status": status,
    }
    return files


def main(argv: list[str]) -> int:
    target = (
        Path(argv[1])
        if len(argv) > 1
        else ROOT / "frontend" / "public" / "data" / "prices"
    )
    target.mkdir(parents=True, exist_ok=True)
    for old in target.glob("*.json"):
        old.unlink()
    files = build()
    for name, payload in files.items():
        (target / name).write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
    print(f"{len(files) - 1} price files → {target}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
