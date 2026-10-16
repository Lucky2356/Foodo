"""Idempotent loading of the starter data (shared/data). Safe to run on every deployment."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from catalog.services import load_reference, upsert_articles, upsert_products, upsert_recipes, upsert_target_sets
from geo.services import load_chains, load_cities


class Command(BaseCommand):
    help = "Загружает или обновляет стартовые справочники, продукты, рецепты, города и сети без дублей."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("--seed-dir", default=str(settings.FOODO_SEED_DIR))
        parser.add_argument("--skip-geo", action="store_true")

    def handle(self, *args: Any, **options: Any) -> None:
        seed = Path(options["seed_dir"])

        def read(name: str) -> Any:
            path = seed / name
            if not path.exists():
                raise CommandError(f"Нет файла {path}")
            return json.loads(path.read_text(encoding="utf-8"))

        load_reference(read("reference.json"))
        self.stdout.write("Справочники: обновлены")
        for label, result in (
            ("Продукты", upsert_products(read("products.json")["products"])),
            ("Рецепты", upsert_recipes(read("recipes.json")["recipes"])),
            ("Нормы витаминов", upsert_target_sets(read("nutrient_targets.json")["sets"])),
            ("Статьи", upsert_articles(read("articles.json")["articles"])),
        ):
            data = result.as_dict()
            if data["errors"]:
                for e in data["errors"][:20]:
                    self.stderr.write(f"{e['path']}: {e['message']}")
                raise CommandError(f"{label}: ошибки валидации ({len(data['errors'])}), ничего не записано.")
            self.stdout.write(f"{label}: создано {data['created']}, обновлено {data['updated']}, без изменений {data['unchanged']}")
        if not options["skip_geo"]:
            cities = load_cities(read("geo/cities.json")["cities"])
            chains = load_chains(read("geo/chains.json")["chains"])
            self.stdout.write(f"Города: {cities}; сети: {chains}")
