"""Applies the reviewed photo selection: downloads each chosen Commons file, stores a WebP copy
and returns the credit data for the recipe.

    python -m scripts.photos.apply OUT_DIR

Input: shared/data/photos/selection.json — {"recipe-id": "File:Title.jpg" | null}. null means
«no suitable free photo»: the recipe keeps the drawn placeholder (never presented as a photo).
Output: OUT_DIR/photos/<recipe-id>.webp and OUT_DIR/credits.json."""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

from PIL import Image

from .commons import acceptable, download, file_info

ROOT = Path(__file__).resolve().parents[2]
WIDTH = 800


def main(argv: list[str]) -> int:
    out = Path(argv[1])
    (out / "photos").mkdir(parents=True, exist_ok=True)
    selection = json.loads(
        (ROOT / "shared/data/photos/selection.json").read_text(encoding="utf-8")
    )
    credits, problems = {}, []
    for rid, title in sorted(selection.items()):
        if not title:
            continue
        info = file_info(title, WIDTH)
        if info is None or not acceptable(info):
            problems.append(
                f"{rid}: {title} — файл не найден или лицензия/формат не подходят"
            )
            continue
        img = Image.open(io.BytesIO(download(info["thumb"]))).convert("RGB")
        img.thumbnail((WIDTH, WIDTH))
        img.save(out / "photos" / f"{rid}.webp", "WEBP", quality=78, method=6)
        credits[rid] = {
            "url": f"photos/{rid}.webp",
            "source": f"Фото: {info['artist'] or 'автор не указан'}, Wikimedia Commons",
            "license": info["license"],
            "license_url": info["license_url"],
            "page_url": info["page_url"],
        }
        print(f"{rid}: {title} ({info['license']})")
    (out / "credits.json").write_text(
        json.dumps(credits, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    for p in problems:
        print(p, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
