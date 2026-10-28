"""Reads the official text of МР 2.3.1.0253-21 (Rospotrebnadzor, 2021) and prints the vitamin rows
of the adult tables, so the targets in shared/data/nutrient_targets.json can be checked against the
document itself. Runs in GitHub Actions: the document hosts are not reachable from every
environment."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

from scripts.prices.common import Fetcher, FetchError

# The publisher's own copy first; a regional education institute keeps the same PDF.
SOURCES = (
    "https://www.rospotrebnadzor.ru/upload/iblock/789/1.-mr-2.3.1.0253_21-normy-pishchevykh-veshchestv.pdf",
    "https://nios.ru/sites/default/files/documenty/mr%202_3_1_0253-21_%202_3_1_%20gigiena%20pitaniya_%20racionalnoe%20pitanie.pdf",
)

ROW = re.compile(
    r"(витамин|фолат|фолиев|кобаламин|ретинол|токоферол|пиридоксин|аскорбин)",
    re.IGNORECASE,
)
SECTION = re.compile(
    r"^\s*(5\.\d|Таблица|Нормы физиологических потребностей)", re.IGNORECASE
)


def download() -> tuple[str, bytes]:
    errors = []
    for url in SOURCES:
        try:
            data = Fetcher(url, delay=0, timeout=60, rules=[]).get(url, 30_000_000)
        except FetchError as e:
            errors.append(str(e))
            continue
        if data[:5] == b"%PDF-":
            return url, data
        errors.append(f"не PDF: {url}")
    raise FetchError("; ".join(errors))


def pages(pdf: bytes) -> list[str]:
    return [p.extract_text() or "" for p in PdfReader(io.BytesIO(pdf)).pages]


# Tables 11 (men) and 16 (women): adult vitamin requirements, row label per Foodo nutrient id.
ADULT_TABLES = {"male": "в витаминах для мужчин", "female": "в витаминах для женщин"}
ROWS = {
    "vit_c": r"Витамин C, мг",
    "vit_b6": r"Витамин B6, мг",
    "vit_b12": r"Витамин B12, мкг",
    "folate": r"Фолаты, мкг",
    "vit_a": r"Витамин A, мкг рет\. экв\.",
    "vit_e": r"Витамин E.*мг ток\. экв\.",
    "vit_d": r"Витамин D, мкг",
}
TARGETS = Path(__file__).resolve().parents[2] / "shared/data/nutrient_targets.json"
SET_ID = "mr-2.3.1.0253-21-adults"


def adult_values(text: list[str]) -> dict[str, dict[str, float]]:
    """The first number of each vitamin row on the page with the table for each sex."""
    out: dict[str, dict[str, float]] = {}
    for sex, title in ADULT_TABLES.items():
        page = next(p for p in text if title in p)
        values: dict[str, float] = {}
        for nutrient, label in ROWS.items():
            m = re.search(label + r"\s+(\d+(?:,\d+)?)", page)
            if m:
                values[nutrient] = float(m.group(1).replace(",", "."))
        out[sex] = values
    return out


def check(values: dict[str, dict[str, float]]) -> list[str]:
    """Differences between the document and the stored targets for adults (the 18+ rows)."""
    doc = json.loads(TARGETS.read_text(encoding="utf-8"))
    targets = next(s for s in doc["sets"] if s["id"] == SET_ID)["targets"]
    problems = []
    for sex, found in values.items():
        missing = sorted(set(ROWS) - set(found))
        if missing:
            problems.append(f"{sex}: строки не найдены в документе: {missing}")
        for nutrient, value in found.items():
            stored = [
                t["value"]
                for t in targets
                if t["nutrient"] == nutrient
                and t.get("sex") in (None, sex)
                and t.get("min_age") is None
            ]
            if stored != [value]:
                problems.append(
                    f"{sex} {nutrient}: в документе {value}, в данных {stored}"
                )
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dump", action="store_true", help="print the vitamin rows with context"
    )
    parser.add_argument(
        "--page", type=int, action="append", default=[], help="print a whole page"
    )
    parser.add_argument(
        "--check", action="store_true", help="compare with nutrient_targets.json"
    )
    args = parser.parse_args(argv)
    try:
        url, pdf = download()
    except FetchError as e:
        print(f"Документ не скачан: {e}", file=sys.stderr)
        return 1
    text = pages(pdf)
    print(
        f"source: {url}\nsha256: {hashlib.sha256(pdf).hexdigest()}\npages: {len(text)}"
    )
    if args.dump:
        for n, page in enumerate(text, start=1):
            for i, line in enumerate(page.splitlines()):
                if ROW.search(line) or SECTION.search(line):
                    print(f"p{n}:{i}: {line}")
    for n in args.page:
        print(f"===== page {n} =====\n{text[n - 1]}")
    if args.check:
        values = adult_values(text)
        print("document (adults):", json.dumps(values, ensure_ascii=False))
        problems = check(values)
        for p in problems:
            print("MISMATCH", p)
        if problems:
            return 1
        print("Нормы для взрослых совпадают с документом.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
