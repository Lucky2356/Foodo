from __future__ import annotations

from django.conf import settings
from django.db import connection
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthView(APIView):
    authentication_classes: list = []
    throttle_classes: list = []

    def get(self, request: Request) -> Response:
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            db = "ok"
        except Exception:  # noqa: BLE001 - health endpoint reports, never raises
            db = "error"
        status = 200 if db == "ok" else 503
        return Response({"status": "ok" if db == "ok" else "degraded", "database": db, "version": settings.FOODO_VERSION}, status=status)


def csrf_failure(request, reason: str = ""):  # type: ignore[no-untyped-def]
    """JSON answer for CSRF failures so the SPA can show a clear message."""
    from django.http import JsonResponse

    return JsonResponse(
        {"error": {"code": "csrf_failed", "message": "Сессия устарела или запрос пришёл с другого сайта. Обновите страницу и повторите.", "details": {}}},
        status=403,
    )
