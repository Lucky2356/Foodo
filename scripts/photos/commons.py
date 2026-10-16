"""Wikimedia Commons API helpers for recipe photos (runs in GitHub Actions only)."""

from __future__ import annotations

import html
import json
import re
import time
import urllib.parse
import urllib.request
from typing import Any

API = "https://commons.wikimedia.org/w/api.php"
# Wikimedia's User-Agent policy asks for a descriptive agent with contact details.
USER_AGENT = "FoodoPhotoBot/0.1 (https://github.com/Lucky2356/Foodo; recipe photos with attribution)"

# Free licenses whose terms the app satisfies by showing author, license and a link.
ALLOWED_LICENSE = re.compile(
    r"^(cc0|public domain|pd|cc by(-sa)? \d(\.\d)?( [a-z]+)?)$", re.IGNORECASE
)
BAD_TITLE = re.compile(
    r"logo|map|poster|menu|label|packag|stamp|coat of arms|diagram|flag|icon|drawing|illustration|sign|banner|advert|screenshot|book|page|painting|\.svg|\.gif|\.tif",
    re.IGNORECASE,
)

_last = 0.0


def _get(params: dict[str, Any]) -> dict[str, Any]:
    global _last
    wait = 0.25 - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()
    url = (
        API
        + "?"
        + urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def plain(value: str) -> str:
    """Commons metadata is HTML: keep the text only."""
    return re.sub(
        r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value or ""))
    ).strip()


def license_link(url: str) -> str | None:
    """Licence deed link for the credit: https only. Commons often stores Creative Commons
    deeds as http://; that host serves the same page over https. Other non-https links are
    dropped rather than shown as an insecure link."""
    if url.startswith("http://creativecommons.org/"):
        url = "https://" + url[len("http://") :]
    return url if url.startswith("https://") else None


def author_name(artist: str) -> str:
    """Short author line. Some uploaders put usage notes into the Artist field after the
    name in parentheses («Name ( Name ) I'd appreciate…»): keep the name only."""
    if len(artist) > 80:
        artist = artist.split(" (", 1)[0].strip() or artist[:80].rstrip() + "…"
    return artist


def describe(page: dict[str, Any]) -> dict[str, Any] | None:
    info = (page.get("imageinfo") or [None])[0]
    if not info:
        return None
    meta = info.get("extmetadata", {})
    license_name = plain(meta.get("LicenseShortName", {}).get("value", ""))
    return {
        "title": page["title"],
        "page_url": info.get("descriptionurl")
        or f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(page['title'].replace(' ', '_'))}",
        "thumb": info.get("thumburl"),
        "url": info.get("url"),
        "width": info.get("width"),
        "height": info.get("height"),
        "mime": info.get("mime"),
        "license": license_name,
        "license_url": plain(meta.get("LicenseUrl", {}).get("value", "")),
        "artist": plain(meta.get("Artist", {}).get("value", ""))[:160],
        "attribution_required": plain(
            meta.get("AttributionRequired", {}).get("value", "true")
        )
        != "false",
        "restrictions": plain(meta.get("Restrictions", {}).get("value", "")),
    }


def acceptable(c: dict[str, Any]) -> bool:
    if not c["thumb"] or c["mime"] not in ("image/jpeg", "image/png", "image/webp"):
        return False
    if not ALLOWED_LICENSE.match(c["license"]) or c["restrictions"]:
        return False
    if not c["width"] or not c["height"] or c["width"] < 500 or c["height"] < 350:
        return False
    ratio = c["width"] / c["height"]
    return 0.6 <= ratio <= 2.2 and not BAD_TITLE.search(c["title"])


def search(query: str, limit: int = 12, thumb_width: int = 240) -> list[dict[str, Any]]:
    data = _get(
        {
            "action": "query",
            "generator": "search",
            "gsrsearch": f"{query} filetype:bitmap",
            "gsrnamespace": 6,
            "gsrlimit": limit,
            "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata",
            "iiurlwidth": thumb_width,
            "iiextmetadatafilter": "LicenseShortName|LicenseUrl|Artist|AttributionRequired|Restrictions",
        }
    )
    pages = sorted(
        data.get("query", {}).get("pages", []), key=lambda p: p.get("index", 0)
    )
    return [c for c in (describe(p) for p in pages) if c]


def file_info(title: str, width: int) -> dict[str, Any] | None:
    data = _get(
        {
            "action": "query",
            "titles": title,
            "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata",
            "iiurlwidth": width,
            "iiextmetadatafilter": "LicenseShortName|LicenseUrl|Artist|AttributionRequired|Restrictions",
        }
    )
    pages = data.get("query", {}).get("pages", [])
    return describe(pages[0]) if pages else None
