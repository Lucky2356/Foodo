"""Reads the official text of МР 2.3.1.0253-21 (Rospotrebnadzor, 2021) and prints the vitamin rows
of the adult tables, so the targets in shared/data/nutrient_targets.json can be checked against the
document itself. Runs in GitHub Actions: the document hosts are not reachable from every
environment."""

from __future__ import annotations

import argparse
import hashlib
import io
import re
import sys

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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dump", action="store_true", help="print the vitamin rows with context"
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
            lines = page.splitlines()
            for i, line in enumerate(lines):
                if ROW.search(line) or SECTION.search(line):
                    print(f"p{n}:{i}: {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
