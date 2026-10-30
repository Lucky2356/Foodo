"""Livsmedelsverket (Swedish Food Agency) food composition database — open data, CC BY 4.0.

    python -m scripts.nutrition.livsmedel --discover  # API description and one food with its nutrients
    python -m scripts.nutrition.livsmedel --list      # every food: number | Swedish name | English name
    python -m scripts.nutrition.livsmedel --apply     # values for livsmedel_map.json → livsmedel_values.json
    python -m scripts.nutrition.livsmedel --check     # the committed livsmedel_values.json matches the API

Runs in GitHub Actions: the API is not reachable from every development environment.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from scripts.prices.common import Fetcher, FetchError

API = "https://dataportal.livsmedelsverket.se/livsmedel"
SWAGGER = API + "/swagger/v1/swagger.json"
HERE = Path(__file__).resolve().parent
MAP = HERE / "livsmedel_map.json"
VALUES = Path(__file__).resolve().parents[1] / "catalog/sources/livsmedel_values.json"


def fetcher() -> Fetcher:
    # rules=None: the site's robots.txt is read and respected; one request a second.
    return Fetcher(API, delay=1, timeout=120, rules=None)


def get(f: Fetcher, path: str) -> Any:
    return json.loads(f.text(API + path))


def foods(f: Fetcher, language: int) -> list[dict[str, Any]]:
    """All foods, page by page (sprak: 1 Swedish, 2 English)."""
    out: list[dict[str, Any]] = []
    while True:
        page = get(f, f"/api/v1/livsmedel?offset={len(out)}&limit=500&sprak={language}")
        items = page["livsmedel"] if isinstance(page, dict) else page
        out += items
        if len(items) < 500:
            return out


def discover(f: Fetcher) -> None:
    swagger = get(f, "/swagger/v1/swagger.json")
    print("api:", json.dumps(swagger.get("info"), ensure_ascii=False))
    for path, ops in swagger.get("paths", {}).items():
        print("path:", path, list(ops))
    first = get(f, "/api/v1/livsmedel?offset=0&limit=2&sprak=2")
    print("list page:", json.dumps(first, ensure_ascii=False)[:1500])
    items = first["livsmedel"] if isinstance(first, dict) else first
    number = items[0]["nummer"]
    for suffix in ("naringsvarden", "klassificeringar", "ingredienser"):
        try:
            data = get(f, f"/api/v1/livsmedel/{number}/{suffix}?sprak=2")
        except FetchError as e:
            print(suffix, e)
            continue
        print(f"{suffix}:", json.dumps(data, ensure_ascii=False)[:6000])


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--discover", action="store_true")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args(argv)
    f = fetcher()
    try:
        if args.discover:
            discover(f)
        if args.list:
            sv = foods(f, 1)
            en = {x["nummer"]: x["namn"] for x in foods(f, 2)}
            for x in sv:
                print(f"{x['nummer']} | {x['namn']} | {en.get(x['nummer'], '')}")
    except FetchError as e:
        print(f"Livsmedelsverket недоступен: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
