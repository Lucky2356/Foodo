#!/usr/bin/env python3
"""Builds shared/data/geo/cities.json from the hflabs/city dataset (CC BY-SA 4.0).

Source: https://github.com/hflabs/city (city.csv). The derived file keeps the same licence and
attribution (shared/data/geo/README.md). Run: python3 scripts/build_cities.py [path/to/city.csv]
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = (
    Path(sys.argv[1])
    if len(sys.argv) > 1
    else ROOT / "shared" / "data" / "geo" / "hflabs-city.csv"
)
OUT = ROOT / "shared" / "data" / "geo" / "cities.json"

# hflabs gives UTC offsets; map them to representative IANA zones (Russia has no DST since 2014).
OFFSET_TO_TZ = {
    "UTC+2": "Europe/Kaliningrad",
    "UTC+3": "Europe/Moscow",
    "UTC+4": "Europe/Samara",
    "UTC+5": "Asia/Yekaterinburg",
    "UTC+6": "Asia/Omsk",
    "UTC+7": "Asia/Krasnoyarsk",
    "UTC+8": "Asia/Irkutsk",
    "UTC+9": "Asia/Yakutsk",
    "UTC+10": "Asia/Vladivostok",
    "UTC+11": "Asia/Magadan",
    "UTC+12": "Asia/Kamchatka",
}


def region_name(row: dict[str, str]) -> str:
    region, kind = row["region"].replace(" /Якутия/", " (Якутия)"), row["region_type"]
    if kind == "Респ":
        if region in {
            "Чувашская",
            "Удмуртская",
            "Кабардино-Балкарская",
            "Карачаево-Черкесская",
            "Чеченская",
        }:
            return f"{region} Республика"
        return f"Республика {region}"
    if kind == "обл":
        return region if "область" in region else f"{region} область"
    if kind == "край":
        return f"{region} край"
    if kind == "АО":
        return (
            region.replace("Автономный", "автономный")
            if "округ" in region
            else f"{region} автономный округ"
        )
    if kind == "Аобл":
        return f"{region} автономная область"
    return region


def main() -> None:
    cities = []
    seen: set[str] = set()
    with SRC.open(encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            name = row["city"] or row["settlement"] or row["region"]
            kladr = row["kladr_id"]
            if not kladr or kladr in seen or not row["geo_lat"]:
                continue
            seen.add(kladr)
            cities.append(
                {
                    "id": kladr,
                    "name": name,
                    "region": region_name(row),
                    "region_type": row["region_type"],
                    "federal_district": row["federal_district"],
                    "timezone": OFFSET_TO_TZ.get(row["timezone"], "Europe/Moscow"),
                    "lat": round(float(row["geo_lat"]), 5),
                    "lon": round(float(row["geo_lon"]), 5),
                    "population": int(row["population"])
                    if row["population"].isdigit()
                    else None,
                }
            )
    cities.sort(key=lambda c: (-(c["population"] or 0), c["name"]))
    OUT.write_text(
        json.dumps(
            {
                "format": "foodo-cities",
                "version": 1,
                "source": "hflabs/city",
                "license": "CC BY-SA 4.0",
                "source_url": "https://github.com/hflabs/city",
                "cities": cities,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"{len(cities)} cities → {OUT}")


if __name__ == "__main__":
    main()
