"""Public price sources for a city and chain, and the priority rules for a household's profile.

Priority per product (docs/PRICES.md):
1. the household's own prices (manual or receipt) — the latest one;
2. prices for the selected chain in the selected city: scraped from the chain's website or the
   median of prices shared by Foodo users (the most recent source wins);
3. the official Rosstat average for the city's region (an estimate, costed by weight).
"""

from __future__ import annotations

import hashlib
import statistics
from datetime import date, timedelta
from typing import Any

from django.conf import settings
from django.db import IntegrityError, transaction

from catalog.models import Product
from engine.units import to_base
from geo.models import City, StoreChain

from .models import PriceObservation

JSON = dict[str, Any]

FRESH_DAYS = {"scraped": 45, "community": 90, "rosstat": 120}


def contributor_hash(user_id: int) -> str:
    return hashlib.sha256(f"{settings.SECRET_KEY}:price-contributor:{user_id}".encode()).hexdigest()


def _entry(o: PriceObservation, kind: str, price_kop: int, source: str, count: int | None = None) -> JSON:
    return {
        "product_id": o.product_id,
        "price_kop": price_kop,
        "package_size": o.package_size,
        "package_unit": o.package_unit,
        "currency": "RUB",
        "date": o.observed_on.isoformat(),
        "source": source,
        "kind": kind,
        "loose": o.loose,
        **({"observations": count} if count is not None else {}),
    }


def public_prices(city: City | None, chain: StoreChain | None, today: date | None = None) -> list[JSON]:
    """Best public entry per product for the city/chain (chain sources first, then Rosstat)."""
    today = today or date.today()
    products = {p.id: p for p in Product.objects.all()}
    chosen: dict[str, JSON] = {}
    if city is not None and chain is not None:
        scraped = PriceObservation.objects.filter(kind="scraped", city=city, chain=chain, observed_on__gte=today - timedelta(days=FRESH_DAYS["scraped"]))
        for o in scraped.order_by("product_id", "-observed_on", "-id"):
            if o.product_id not in chosen:
                chosen[o.product_id] = _entry(o, "scraped", o.price_kop, f"Сайт сети {chain.name}, {city.name}")
        community = PriceObservation.objects.filter(kind="community", city=city, chain=chain, observed_on__gte=today - timedelta(days=FRESH_DAYS["community"]))
        groups: dict[str, list[PriceObservation]] = {}
        for o in community.order_by("-observed_on", "-id"):
            groups.setdefault(o.product_id, []).append(o)
        for pid, obs in groups.items():
            product = products.get(pid)
            if product is None:
                continue
            newest = obs[0]
            if pid in chosen and chosen[pid]["date"] >= newest.observed_on.isoformat():
                continue
            per_unit = []
            pj = {"base_unit": product.base_unit, "density_g_ml": product.density_g_ml, "piece_g": product.piece_g, "spoon_g": product.spoon_g}
            for o in obs:
                size = to_base(pj, o.package_size, o.package_unit)
                if size:
                    per_unit.append(o.price_kop / size)
            size_newest = to_base(pj, newest.package_size, newest.package_unit)
            if not per_unit or not size_newest:
                continue
            median_kop = int(statistics.median(per_unit) * size_newest + 0.5)
            chosen[pid] = _entry(newest, "community", median_kop, f"Медиана цен пользователей Foodo, {chain.name}, {city.name}", len(obs))
    if city is not None:
        rosstat = PriceObservation.objects.filter(kind="rosstat", region=city.region, observed_on__gte=today - timedelta(days=FRESH_DAYS["rosstat"]))
        for o in rosstat.order_by("product_id", "-observed_on", "-id"):
            if o.product_id not in chosen:
                chosen[o.product_id] = _entry(o, "rosstat", o.price_kop, f"Росстат, средняя цена, {city.region}")
    return [chosen[k] for k in sorted(chosen)]


def merge_price_sources(own: list[JSON], public: list[JSON]) -> list[JSON]:
    """One entry per product: own prices beat any public source regardless of date."""
    result: dict[str, JSON] = {}
    for e in public:
        result[e["product_id"]] = e
    latest_own: dict[str, JSON] = {}
    for e in own:
        current = latest_own.get(e["product_id"])
        if current is None or e["date"] >= current["date"]:
            latest_own[e["product_id"]] = e
    result.update(latest_own)
    return [result[k] for k in sorted(result)]


def share_observation(
    *, user_id: int, city: City, chain: StoreChain, product_id: str, price_kop: int, package_size: float, package_unit: str, loose: bool, observed_on: date
) -> bool:
    """Stores an anonymous community observation. Returns False for an exact repeat."""
    try:
        with transaction.atomic():
            PriceObservation.objects.create(
                kind="community",
                product_id=product_id,
                chain=chain,
                city=city,
                region=city.region,
                price_kop=price_kop,
                package_size=package_size,
                package_unit=package_unit,
                loose=loose,
                observed_on=observed_on,
                source="Пользователь Foodo",
                contributor_hash=contributor_hash(user_id),
            )
    except IntegrityError:
        return False
    return True


def import_observations(rows: list[JSON], kind: str) -> dict[str, Any]:
    """Validated idempotent import of scraped or Rosstat observations (from the price workflow)."""
    from datetime import date as _date

    products = set(Product.objects.values_list("id", flat=True))
    chains = {c.id: c for c in StoreChain.objects.all()}
    cities = {c.id: c for c in City.objects.all()}
    regions = set(City.objects.values_list("region", flat=True))
    errors: list[str] = []
    valid: list[PriceObservation] = []
    for i, r in enumerate(rows):
        where = f"[{i}]"
        if r.get("product_id") not in products:
            errors.append(f"{where} неизвестный продукт {r.get('product_id')}")
            continue
        price = r.get("price_kop")
        size = r.get("package_size")
        if (
            not isinstance(price, int)
            or price <= 0
            or not isinstance(size, (int, float))
            or size <= 0
            or r.get("package_unit") not in {"g", "kg", "ml", "l", "pcs"}
        ):
            errors.append(f"{where} некорректная цена или упаковка")
            continue
        try:
            observed = _date.fromisoformat(r["observed_on"])
        except (KeyError, TypeError, ValueError):
            errors.append(f"{where} некорректная дата")
            continue
        chain = city = None
        region = r.get("region") or ""
        if kind == "scraped":
            chain = chains.get(r.get("chain_id"))
            city = cities.get(r.get("city_id"))
            if chain is None or city is None:
                errors.append(f"{where} неизвестная сеть или город")
                continue
            region = city.region
        elif region not in regions:
            errors.append(f"{where} неизвестный регион {region}")
            continue
        valid.append(
            PriceObservation(
                kind=kind,
                product_id=r["product_id"],
                chain=chain,
                city=city,
                region=region,
                price_kop=price,
                package_size=float(size),
                package_unit=r["package_unit"],
                loose=bool(r.get("loose", kind == "rosstat")),
                observed_on=observed,
                source=str(r.get("source", ""))[:200],
                source_url=str(r.get("source_url", ""))[:500],
                external_id=str(r.get("external_id", ""))[:200],
            )
        )
    created = 0
    if not errors:
        before = PriceObservation.objects.filter(kind=kind).count()
        PriceObservation.objects.bulk_create(valid, ignore_conflicts=True, batch_size=1000)
        created = PriceObservation.objects.filter(kind=kind).count() - before
    return {"received": len(rows), "created": created, "duplicates": len(valid) - created if not errors else 0, "errors": errors[:100]}
