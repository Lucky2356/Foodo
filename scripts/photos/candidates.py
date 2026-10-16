"""Finds Commons photo candidates for every recipe and draws numbered contact sheets for review.

    python -m scripts.photos.candidates OUT_DIR

Output: OUT_DIR/candidates.json and OUT_DIR/sheet-NN.jpg. A person (or reviewer) looks at every
sheet and writes shared/data/photos/selection.json; nothing is applied automatically."""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .commons import acceptable, download, search

ROOT = Path(__file__).resolve().parents[2]
FONT = ROOT / "frontend" / "public" / "fonts" / "DejaVuSans.ttf"
PER_RECIPE = 6
ROWS_PER_SHEET = 8
CELL_W, CELL_H, LABEL_W = 240, 180, 260


def queries() -> dict[str, list[str]]:
    out = {}
    for line in (
        (Path(__file__).parent / "queries.txt").read_text(encoding="utf-8").splitlines()
    ):
        if line.strip() and not line.startswith("#"):
            rid, _, rest = line.partition(":")
            out[rid.strip()] = [q.strip() for q in rest.split(";") if q.strip()]
    return out


def main(argv: list[str]) -> int:
    out = Path(argv[1])
    out.mkdir(parents=True, exist_ok=True)
    recipes = json.loads(
        (ROOT / "shared/data/recipes.json").read_text(encoding="utf-8")
    )["recipes"]
    selection_path = ROOT / "shared/data/photos/selection.json"
    decided = (
        json.loads(selection_path.read_text(encoding="utf-8"))
        if selection_path.exists()
        else {}
    )
    only = set(argv[2].split(",")) if len(argv) > 2 else None
    q = queries()
    result: dict[str, list[dict]] = {}
    for r in recipes:
        if r["id"] in decided or (only and r["id"] not in only):
            continue
        seen, found = set(), []
        for query in q.get(r["id"], []):
            try:
                hits = search(query)
            except Exception as e:  # noqa: BLE001 — one failed query must not stop the run
                print(f"{r['id']}: search failed for {query!r}: {e}", file=sys.stderr)
                continue
            for c in hits:
                if c["title"] not in seen and acceptable(c):
                    seen.add(c["title"])
                    found.append(c)
            if len(found) >= PER_RECIPE:
                break
        result[r["id"]] = [{"n": i + 1, **c} for i, c in enumerate(found[:PER_RECIPE])]
        print(f"{r['id']}: {len(result[r['id']])} candidates")
    (out / "candidates.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    font = ImageFont.truetype(str(FONT), 15)
    small = ImageFont.truetype(str(FONT), 12)
    names = {r["id"]: r["name"] for r in recipes}
    ids = list(result)
    for s in range(0, len(ids), ROWS_PER_SHEET):
        chunk = ids[s : s + ROWS_PER_SHEET]
        sheet = Image.new(
            "RGB",
            (LABEL_W + PER_RECIPE * (CELL_W + 6), len(chunk) * (CELL_H + 10)),
            "white",
        )
        draw = ImageDraw.Draw(sheet)
        for row, rid in enumerate(chunk):
            y = row * (CELL_H + 10)
            draw.text((6, y + 6), rid, font=small, fill="black")
            words, line, lines = names[rid].split(), "", []
            for w in words:
                if len(line) + len(w) > 26:
                    lines.append(line)
                    line = ""
                line = f"{line} {w}".strip()
            lines.append(line)
            for i, text in enumerate(lines[:5]):
                draw.text((6, y + 26 + i * 18), text, font=font, fill="black")
            for c in result[rid]:
                x = LABEL_W + (c["n"] - 1) * (CELL_W + 6)
                try:
                    img = Image.open(io.BytesIO(download(c["thumb"]))).convert("RGB")
                    img.thumbnail((CELL_W, CELL_H - 18))
                    sheet.paste(img, (x, y + 18))
                except Exception as e:  # noqa: BLE001
                    draw.text(
                        (x, y + 60), f"нет миниатюры: {e}"[:40], font=small, fill="red"
                    )
                draw.rectangle((x, y, x + 26, y + 17), fill="black")
                draw.text((x + 6, y + 1), str(c["n"]), font=font, fill="white")
        sheet.save(out / f"sheet-{s // ROWS_PER_SHEET + 1:02d}.jpg", quality=82)
    print(f"{len(ids)} recipes, {sum(len(v) for v in result.values())} candidates")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
