"""Openverse API helpers: a second source of free-licensed recipe photos (Flickr and other
collections it indexes) for dishes Commons has no good photo of. Runs in GitHub Actions only.

Candidates use the same shape as Commons ones, with the title «openverse:<id>», so the contact
sheets, the selection file and the license checks work the same way."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .commons import USER_AGENT

API = "https://api.openverse.org/v1"
PREFIX = "openverse:"
# Short timeout: when Openverse does not answer runners, the run must not stall on it.
TIMEOUT = 20
# Openverse license codes the app can honour by showing author, license and a link.
LICENSES = {"cc0": "CC0", "pdm": "Public domain", "by": "CC BY", "by-sa": "CC BY-SA"}
MIME = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}
PROVIDER_NAMES = {"flickr": "Flickr", "wikimedia": "Wikimedia Commons"}


class RateLimited(Exception):
    """Openverse answered 429: the caller stops asking it for the rest of the run."""


_last = 0.0
_token: str | None = None


def _auth_header() -> dict[str, str]:
    """Optional OAuth client credentials (secrets OPENVERSE_CLIENT_ID / _SECRET) raise the rate
    limit; without them the anonymous limit applies."""
    global _token
    cid, secret = (
        os.environ.get("OPENVERSE_CLIENT_ID"),
        os.environ.get("OPENVERSE_CLIENT_SECRET"),
    )
    if not cid or not secret:
        return {}
    if _token is None:
        body = urllib.parse.urlencode(
            {
                "grant_type": "client_credentials",
                "client_id": cid,
                "client_secret": secret,
            }
        ).encode()
        req = urllib.request.Request(
            f"{API}/auth_tokens/token/", data=body, headers={"User-Agent": USER_AGENT}
        )
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            _token = json.loads(r.read())["access_token"]
    return {"Authorization": f"Bearer {_token}"}


def _get(path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    global _last
    wait = 1.0 - (time.monotonic() - _last)
    if wait > 0:
        time.sleep(wait)
    _last = time.monotonic()
    url = f"{API}{path}" + (f"?{urllib.parse.urlencode(params)}" if params else "")
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, **_auth_header()}
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise RateLimited(url) from e
        raise


def license_name(code: str, version: str | None) -> str | None:
    base = LICENSES.get((code or "").lower())
    if base is None:
        return None
    return f"{base} {version}" if base.startswith("CC BY") and version else base


def describe(item: dict[str, Any]) -> dict[str, Any] | None:
    name = license_name(item.get("license", ""), item.get("license_version"))
    if name is None:
        return None
    ext = (
        item.get("filetype")
        or urllib.parse.urlparse(item.get("url") or "").path.rsplit(".", 1)[-1]
    ).lower()
    provider = item.get("source") or item.get("provider") or ""
    return {
        "title": PREFIX + item["id"],
        "page_url": item.get("foreign_landing_url") or "",
        "thumb": f"{API}/images/{item['id']}/thumb/",
        "url": item.get("url"),
        "width": item.get("width"),
        "height": item.get("height"),
        "mime": MIME.get(ext),
        "license": name,
        "license_url": item.get("license_url") or "",
        "artist": (item.get("creator") or "")[:160],
        "attribution_required": not name.startswith(("CC0", "Public")),
        "restrictions": "",
        "provider": PROVIDER_NAMES.get(provider, provider.capitalize()),
        "provider_id": provider,
    }


def search(query: str, limit: int = 12) -> list[dict[str, Any]]:
    data = _get(
        "/images/",
        {
            "q": query,
            "license": ",".join(LICENSES),
            "page_size": limit,
            "mature": "false",
            "excluded_source": "wikimedia",  # Commons is searched directly
        },
    )
    out = []
    for item in data.get("results", []):
        c = describe(item)
        if c and c["provider_id"] != "wikimedia":
            out.append(c)
    return out


def image_info(ref: str) -> dict[str, Any] | None:
    """Current metadata of a selected image («openverse:<id>»), re-checked before applying."""
    image_id = ref.removeprefix(PREFIX)
    if not image_id.replace("-", "").isalnum():
        return None
    try:
        return describe(_get(f"/images/{urllib.parse.quote(image_id)}/"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
