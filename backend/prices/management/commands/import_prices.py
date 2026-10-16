from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from django.core.management.base import BaseCommand, CommandError

from prices.services import import_observations


class Command(BaseCommand):
    help = "Импорт наблюдений цен (scraped или rosstat) из JSON, подготовленного workflow цен. Повтор не создаёт дублей."

    def add_arguments(self, parser: Any) -> None:
        parser.add_argument("path")
        parser.add_argument("--kind", choices=["scraped", "rosstat"], required=True)

    def handle(self, *args: Any, **options: Any) -> None:
        data = json.loads(Path(options["path"]).read_text(encoding="utf-8"))
        rows = data["observations"] if isinstance(data, dict) else data
        result = import_observations(rows, options["kind"])
        if result["errors"]:
            for e in result["errors"][:20]:
                self.stderr.write(e)
            raise CommandError(f"Ошибки валидации: {len(result['errors'])}. Ничего не записано.")
        self.stdout.write(json.dumps(result, ensure_ascii=False))
