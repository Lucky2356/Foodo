from __future__ import annotations

import math
from typing import Any

from django.db import transaction

from .models import City, StoreChain

JSON = dict[str, Any]


@transaction.atomic
def load_cities(cities: list[JSON]) -> dict[str, int]:
    existing = {c.id: c for c in City.objects.all()}
    created = updated = 0
    to_create: list[City] = []
    fields = ["name", "region", "region_type", "federal_district", "timezone", "lat", "lon", "population"]
    for c in cities:
        obj = existing.get(c["id"])
        if obj is None:
            to_create.append(City(**{"id": c["id"], **{f: c.get(f) for f in fields}}))
            created += 1
        elif any(getattr(obj, f) != c.get(f) for f in fields):
            for f in fields:
                setattr(obj, f, c.get(f))
            obj.save()
            updated += 1
    City.objects.bulk_create(to_create, batch_size=500)
    return {"created": created, "updated": updated, "unchanged": len(cities) - created - updated}


@transaction.atomic
def load_chains(chains: list[JSON]) -> dict[str, int]:
    created = 0
    for c in chains:
        _, was_created = StoreChain.objects.update_or_create(
            id=c["id"],
            defaults={k: c.get(k) for k in ("name", "kind", "website", "nationwide", "federal_districts", "regions", "presence_verified", "note", "position")},
        )
        created += int(was_created)
    return {"created": created, "updated": len(chains) - created}


def chains_for_city(city: City) -> list[StoreChain]:
    return [c for c in StoreChain.objects.all() if c.present_in(city)]


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))
