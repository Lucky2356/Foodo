"""HTTP helpers for the price workflow: an honest User-Agent, robots.txt rules, a polite rate limit.

Runs in GitHub Actions only (see .github/workflows/prices.yml), never on the owner's computer."""

from __future__ import annotations

import http.client
import http.cookiejar
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field

USER_AGENT = "FoodoPriceBot/0.1 (+https://github.com/Lucky2356/Foodo; free meal planner, weekly price check)"

# Rosstat's sites use the Russian Trusted Root CA (Минцифры), which is absent from public trust
# stores. The root comes from the official Gosuslugi address, the 2024 SSL sub-CA from the address
# in the certificates' own AIA field. Both are added to a dedicated context used only for Rosstat.
RUSSIAN_CA_URLS = (
    "https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt",
    "http://nuc-cdp.digital.gov.ru/cdp/subca_ssl_rsa2024.crt",
)


class FetchError(Exception):
    pass


def robots_rules(text: str, agent: str = "*") -> list[tuple[bool, str]]:
    """(allow, pattern) rules of the group that applies to `agent` (falls back to `*`)."""
    groups: dict[str, list[tuple[bool, str]]] = {}
    current: list[str] = []
    last_was_agent = False
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, value = (part.strip() for part in line.split(":", 1))
        key = key.lower()
        if key == "user-agent":
            if not last_was_agent:
                current = []
            current.append(value.lower())
            groups.setdefault(value.lower(), [])
            last_was_agent = True
            continue
        last_was_agent = False
        if key in ("allow", "disallow") and current:
            for name in current:
                if value or key == "allow":
                    groups[name].append((key == "allow", value))
    return groups.get(agent.lower()) or groups.get("*", [])


def _pattern_regex(pattern: str) -> re.Pattern[str]:
    anchored = pattern.endswith("$")
    body = re.escape(pattern[:-1] if anchored else pattern).replace(r"\*", ".*")
    return re.compile(body + ("$" if anchored else ""))


def robots_allows(rules: list[tuple[bool, str]], url: str) -> bool:
    """Google-style matching: the longest matching pattern wins, Allow wins a tie."""
    parsed = urllib.parse.urlsplit(url)
    # Keep a trailing «?» (urlsplit drops an empty query): rules such as «/*?$» depend on it.
    path = (parsed.path or "/") + (
        "?" + parsed.query if parsed.query or url.split("#", 1)[0].endswith("?") else ""
    )
    best: tuple[int, bool] | None = None
    for allow, pattern in rules:
        if not pattern:
            continue
        if _pattern_regex(pattern).match(path):
            candidate = (len(pattern), allow)
            if (
                best is None
                or candidate[0] > best[0]
                or (candidate[0] == best[0] and allow)
            ):
                best = candidate
    return True if best is None else best[1]


@dataclass
class Fetcher:
    """One fetcher per site: checks robots.txt once and waits `delay` seconds between requests."""

    base: str
    delay: float = 2.0
    context: ssl.SSLContext | None = None
    timeout: float = 60
    rules: list[tuple[bool, str]] | None = None
    # Sites that set a cookie and redirect to the same page need an ordinary cookie jar.
    cookies: http.cookiejar.CookieJar | None = None
    requests: int = 0
    _last: float = field(default=0.0)

    def _open(self, url: str, limit: int) -> bytes:
        wait = self.delay - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()
        self.requests += 1
        req = urllib.request.Request(
            url, headers={"User-Agent": USER_AGENT, "Accept-Language": "ru"}
        )
        handlers: list[urllib.request.BaseHandler] = [
            urllib.request.HTTPSHandler(context=self.context)
        ]
        if self.cookies is not None:
            handlers.append(urllib.request.HTTPCookieProcessor(self.cookies))
        try:
            with urllib.request.build_opener(*handlers).open(
                req, timeout=self.timeout
            ) as r:
                return r.read(limit)
        except urllib.error.HTTPError as e:
            raise FetchError(f"HTTP {e.code} {url}") from e
        # A dropped connection or a cut-off body is a failed request like a timeout: the source is
        # reported as failed and the other sources still run.
        except (
            urllib.error.URLError,
            TimeoutError,
            ssl.SSLError,
            ConnectionError,
            http.client.HTTPException,
        ) as e:
            raise FetchError(f"{type(e).__name__}: {e} ({url})") from e

    def get(self, url: str, limit: int = 60_000_000) -> bytes:
        if self.rules is None:
            try:
                self.rules = robots_rules(
                    self._open(self.base.rstrip("/") + "/robots.txt", 500_000).decode(
                        "utf-8", "replace"
                    )
                )
            except FetchError:
                self.rules = []  # no robots.txt → no restrictions published
        if not robots_allows(self.rules, url):
            raise FetchError(f"robots.txt запрещает {url}")
        return self._open(url, limit)

    def text(self, url: str) -> str:
        return self.get(url).decode("utf-8", "replace")


def russian_ca_context() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    for url in RUSSIAN_CA_URLS:
        fetcher = Fetcher(
            url, delay=0, rules=[]
        )  # certificate files, not crawled pages
        pem = fetcher.get(url, 100_000).decode("ascii", "replace")
        if "BEGIN CERTIFICATE" not in pem:
            raise FetchError(f"Не сертификат: {url}")
        ctx.load_verify_locations(cadata=pem)
    return ctx
