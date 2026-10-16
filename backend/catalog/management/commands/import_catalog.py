from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand, CommandError

from catalog.importers import import_catalog_file


class Command(BaseCommand):
    help = "Импорт продуктов/рецептов из JSON (общий формат) или продуктов из CSV. --dry-run только проверяет."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("path")
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args: Any, **options: Any) -> None:
        path = Path(options["path"])
        try:
            result = import_catalog_file(path.name, path.read_bytes(), dry_run=options["dry_run"])
        except ValueError as e:
            raise CommandError(str(e)) from e
        self.stdout.write(json.dumps(result, ensure_ascii=False, indent=1))
        if any(part.get("errors") for part in result.values()):
            raise CommandError("Найдены ошибки, изменения не записаны.")
