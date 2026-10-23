"""Collects public prices and writes shared/data/prices/*.json (run by .github/workflows/prices.yml).

    python -m scripts.prices.run            # all sources
    python -m scripts.prices.run --dry-run  # collect and print a summary, write nothing

Each source is independent: a failed source keeps its previous data and is reported in
status.json with the reason (blocked, robots.txt, site changed…) instead of being faked."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import magnit, metro, rosstat
from .common import Fetcher, FetchError, russian_ca_context

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "shared" / "data"
OUT = DATA / "prices"

# Chains whose websites were checked but are not collected, with the reason found from GitHub's
# network. Re-checked on every run so the status stays current.
CHECK_ONLY = {
    "pyaterochka": "https://5ka.ru",
    "perekrestok": "https://www.perekrestok.ru",
    "lenta": "https://lenta.com",
    "auchan": "https://www.auchan.ru",
    "okey": "https://www.okeydostavka.ru",
    "dixy": "https://dixy.ru",
    "vkusvill": "https://vkusvill.ru",
    "monetka": "https://monetka.ru",
    "globus": "https://online.globus.ru",
    "spar": "https://myspar.ru",
    "maria_ra": "https://www.maria-ra.ru",
}
NOT_COLLECTED_REASON = {
    # Checked 23.10.2026: the pages answer HTTP 401 with Qrator's script check (qauth.js); prices
    # come only after running it, i.e. only to something posing as a browser — not done here.
    "lenta": "Страницы товаров закрыты проверкой браузера (Qrator): цены видны только после выполнения скрипта, а выдавать сборщик за браузер мы не будем.",
    "auchan": "Сайт закрыт проверкой браузера (Qrator): цены видны только после выполнения скрипта, а выдавать сборщик за браузер мы не будем.",
    "monetka": "Страницы каталога закрыты проверкой браузера (Qrator): цены видны только после выполнения скрипта, а выдавать сборщик за браузер мы не будем.",
    "vkusvill": "Сайт доступен, но вес и единица товара не публикуются в машиночитаемом виде — без них цена за кг была бы догадкой.",
}


def now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def load(name: str) -> Any:
    return json.loads((DATA / name).read_text(encoding="utf-8"))


def write(name: str, payload: dict[str, Any]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(
        json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )


def previous_status() -> dict[str, Any]:
    path = OUT / "status.json"
    return (
        json.loads(path.read_text(encoding="utf-8"))
        if path.exists()
        else {"sources": {}}
    )


# Fields that only describe a chain that is checked, not collected. A chain that moves from the
# check list to a collector must lose them, or the settings page keeps saying it is not collected.
CHECK_ONLY_FIELDS = ("collected", "reachable", "detail", "reason")


def source_entry(
    previous: dict[str, Any], ok: bool, at: str, **fields: Any
) -> dict[str, Any]:
    """Status of a collected source: keeps the last good summary when a run fails."""
    entry = {k: v for k, v in previous.items() if k not in CHECK_ONLY_FIELDS}
    entry.update(fields, checked_at=at, ok=ok)
    if ok:
        entry["updated_at"] = at
        entry.pop("error", None)
    return entry


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--only", choices=["rosstat", "magnit", "metro", "check"], action="append"
    )
    args = parser.parse_args(argv)
    only = set(args.only or ["rosstat", "magnit", "metro", "check"])
    cities = load("geo/cities.json")["cities"]
    products = {p["id"]: p for p in load("products.json")["products"]}
    status = previous_status()
    sources: dict[str, Any] = status.setdefault("sources", {})

    def record(key: str, ok: bool, **fields: Any) -> None:
        sources[key] = source_entry(sources.get(key, {}), ok, now(), **fields)

    if "rosstat" in only:
        try:
            observations, summary = rosstat.collect(cities, russian_ca_context())
            unknown = sorted({o["product_id"] for o in observations} - set(products))
            if unknown:
                raise ValueError(
                    f"Неизвестные продукты в соответствии Росстата: {unknown}"
                )
            if not args.dry_run:
                write(
                    "rosstat.json",
                    {
                        "format": "foodo-price-observations",
                        "version": 1,
                        "kind": "rosstat",
                        "collected_at": now(),
                        "summary": summary,
                        "observations": observations,
                    },
                )
            record(
                "rosstat",
                True,
                name="Росстат, средние потребительские цены",
                observations=len(observations),
                **summary,
            )
            print(
                f"rosstat: {len(observations)} observations, {summary['regions']} regions, {summary['cities']} cities, period {summary['period']}"
            )
        except (FetchError, ValueError, KeyError, StopIteration) as e:
            record(
                "rosstat",
                False,
                name="Росстат, средние потребительские цены",
                error=str(e)[:300],
            )
            print(f"rosstat FAILED: {e}", file=sys.stderr)

    if "magnit" in only:
        try:
            observations, summary = magnit.collect(products, cities)
            if not observations:
                raise ValueError(
                    "Ни одна позиция каталога не сопоставлена с продуктами Foodo"
                )
            if not args.dry_run:
                write(
                    "scraped-magnit.json",
                    {
                        "format": "foodo-price-observations",
                        "version": 1,
                        "kind": "scraped",
                        "collected_at": now(),
                        "summary": summary,
                        "observations": observations,
                    },
                )
            record("magnit", True, name="Магнит, magnit.ru", **summary)
            print(f"magnit: {summary}")
        except (FetchError, ValueError) as e:
            record("magnit", False, name="Магнит, magnit.ru", error=str(e)[:300])
            print(f"magnit FAILED: {e}", file=sys.stderr)

    if "metro" in only:
        try:
            observations, summary = metro.collect(products, cities)
            if not observations:
                raise ValueError(
                    "Ни одна позиция каталога не сопоставлена с продуктами Foodo"
                )
            if not args.dry_run:
                write(
                    "scraped-metro.json",
                    {
                        "format": "foodo-price-observations",
                        "version": 1,
                        "kind": "scraped",
                        "collected_at": now(),
                        "summary": summary,
                        "observations": observations,
                    },
                )
            record("metro", True, name="Metro, online.metro-cc.ru", **summary)
            print(f"metro: {summary}")
            if args.dry_run:
                for o in observations:
                    print(
                        f"  {o['product_id']}: {o['price_kop'] / 100} ₽ за {o['package_size']} {o['package_unit']} — {o['source']}"
                    )
        except (FetchError, ValueError) as e:
            record("metro", False, name="Metro, online.metro-cc.ru", error=str(e)[:300])
            print(f"metro FAILED: {e}", file=sys.stderr)

    if "check" in only:
        for chain, site in CHECK_ONLY.items():
            fetcher = Fetcher(site, delay=0, timeout=20)
            fetcher.rules = []
            try:
                fetcher.get(site.rstrip("/") + "/robots.txt", 200_000)
                reachable, detail = True, "доступен"
            except FetchError as e:
                reachable, detail = False, str(e)[:200]
            reason = NOT_COLLECTED_REASON.get(chain) or (
                "Сайт отвечает, сбор цен ещё не реализован."
                if reachable
                else "Сайт недоступен из сети GitHub Actions (блокировка или защита от ботов)."
            )
            sources[chain] = {
                "name": chain,
                "collected": False,
                "reachable": reachable,
                "detail": detail,
                "reason": reason,
                "checked_at": now(),
            }

    status["generated_at"] = now()
    if not args.dry_run:
        write("status.json", status)
    failed = [
        k
        for k in ("rosstat", "magnit", "metro")
        if k in only and not sources.get(k, {}).get("ok")
    ]
    return (
        1
        if len(failed) == len([k for k in ("rosstat", "magnit", "metro") if k in only])
        and failed
        else 0
    )


if __name__ == "__main__":
    sys.exit(main())
