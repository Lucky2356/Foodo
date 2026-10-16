"""Idempotent loading of the starter data (shared/data). Safe to run on every deployment.

Only seed rows that changed since the previous load are written (see SeedState), so an
administrator's corrections of unchanged rows survive restarts. `--force` re-applies everything."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from catalog.models import SeedState
from catalog.services import ImportResult, load_reference, upsert_articles, upsert_products, upsert_recipes, upsert_target_sets
from geo.services import load_chains, load_cities


def _hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


class Command(BaseCommand):
    help = "Загружает или обновляет стартовые справочники, продукты, рецепты, города и сети без дублей."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--seed-dir", default=str(settings.FOODO_SEED_DIR))
        parser.add_argument("--skip-geo", action="store_true")
        parser.add_argument("--force", action="store_true", help="Применить все строки, даже не изменившиеся с прошлой загрузки.")

    def handle(self, *args: Any, **options: Any) -> None:
        seed = Path(options["seed_dir"])
        force: bool = options["force"]

        def read(name: str) -> Any:
            path = seed / name
            if not path.exists():
                raise CommandError(f"Нет файла {path}")
            return json.loads(path.read_text(encoding="utf-8"))

        def whole_file(name: str, data: Any, apply: Callable[[Any], Any]) -> Any:
            """Files without per-row ids worth tracking: applied only when the file changed."""
            digest = _hash(data)
            state = SeedState.objects.filter(pk=name).first()
            if not force and state is not None and state.file_hash == digest:
                return None
            with transaction.atomic():
                result = apply(data)
                SeedState.objects.update_or_create(name=name, defaults={"file_hash": digest, "rows": {}})
            return result

        def rows(name: str, label: str, items: list[dict[str, Any]], upsert: Callable[[list[dict[str, Any]]], ImportResult]) -> None:
            state = SeedState.objects.filter(pk=name).first()
            previous: dict[str, str] = {} if force or state is None else state.rows
            hashes = {str(item["id"]): _hash(item) for item in items}
            changed = [item for item in items if previous.get(str(item["id"])) != hashes[str(item["id"])]]
            skipped = len(items) - len(changed)
            with transaction.atomic():
                data = upsert(changed).as_dict() if changed else {"created": 0, "updated": 0, "unchanged": 0, "errors": []}
                if data["errors"]:
                    for e in data["errors"][:20]:
                        self.stderr.write(f"{e['path']}: {e['message']}")
                    raise CommandError(f"{label}: ошибки валидации ({len(data['errors'])}), ничего не записано.")
                SeedState.objects.update_or_create(name=name, defaults={"file_hash": _hash(items), "rows": hashes})
            self.stdout.write(f"{label}: создано {data['created']}, обновлено {data['updated']}, без изменений {data['unchanged'] + skipped}")

        if whole_file("reference", read("reference.json"), load_reference) is None:
            self.stdout.write("Справочники: без изменений")
        else:
            self.stdout.write("Справочники: обновлены")
        rows("products", "Продукты", read("products.json")["products"], upsert_products)
        rows("recipes", "Рецепты", read("recipes.json")["recipes"], upsert_recipes)
        rows("nutrient_targets", "Нормы витаминов", read("nutrient_targets.json")["sets"], upsert_target_sets)
        rows("articles", "Статьи", read("articles.json")["articles"], upsert_articles)
        if not options["skip_geo"]:
            cities = whole_file("geo/cities", read("geo/cities.json")["cities"], load_cities)
            chains = whole_file("geo/chains", read("geo/chains.json")["chains"], load_chains)
            self.stdout.write(f"Города: {cities or 'без изменений'}; сети: {chains or 'без изменений'}")
