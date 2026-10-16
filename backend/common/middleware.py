from __future__ import annotations

from collections.abc import Callable

from django.http import HttpRequest, HttpResponse

PUBLIC_PREFIXES = ("/api/catalog/", "/api/geo/", "/api/prices/public", "/api/health", "/api/schema")


class NoStorePrivateApiMiddleware:
    """Private API responses must never be stored by browsers, proxies or the service worker."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        response = self.get_response(request)
        if request.path.startswith("/api/") and not request.path.startswith(PUBLIC_PREFIXES):
            response["Cache-Control"] = "no-store, private"
        return response
