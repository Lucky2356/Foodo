"""Stable error payloads: {"error": {"code", "message", "details"}} with Russian messages."""

from __future__ import annotations

from typing import Any

from django.core.exceptions import PermissionDenied
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_handler

from engine.errors import EngineError

MESSAGES = {
    "not_authenticated": "Войдите в аккаунт.",
    "authentication_failed": "Не удалось войти.",
    "permission_denied": "Недостаточно прав.",
    "not_found": "Не найдено.",
    "method_not_allowed": "Метод не поддерживается.",
    "throttled": "Слишком много запросов. Попробуйте позже.",
    "parse_error": "Некорректный JSON.",
    "unsupported_media_type": "Неподдерживаемый формат данных.",
}


class ApiError(exceptions.APIException):
    def __init__(self, code: str, message: str, status_code: int = 400, details: dict[str, Any] | None = None) -> None:
        super().__init__(detail=message, code=code)
        self.status_code = status_code
        self.error_code = code
        self.message = message
        self.details = details or {}


def error_response(code: str, message: str, status_code: int, details: Any = None) -> Response:
    return Response({"error": {"code": code, "message": message, "details": details or {}}}, status=status_code)


def exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    if isinstance(exc, EngineError):
        return error_response(exc.code, exc.message, status.HTTP_422_UNPROCESSABLE_ENTITY, exc.details)
    if isinstance(exc, ApiError):
        return error_response(exc.error_code, exc.message, exc.status_code, exc.details)
    if isinstance(exc, Http404):
        return error_response("not_found", MESSAGES["not_found"], status.HTTP_404_NOT_FOUND)
    if isinstance(exc, PermissionDenied):
        return error_response("permission_denied", MESSAGES["permission_denied"], status.HTTP_403_FORBIDDEN)
    response = drf_handler(exc, context)
    if response is None:
        return None
    if isinstance(exc, exceptions.ValidationError):
        return error_response("validation_error", "Проверьте введённые данные.", response.status_code, response.data)
    if isinstance(exc, exceptions.APIException):
        code = exc.get_codes() if isinstance(exc.get_codes(), str) else "error"
        if isinstance(exc, exceptions.Throttled):
            return error_response("throttled", MESSAGES["throttled"], response.status_code, {"wait": exc.wait})
        if exc.status_code == 403 and isinstance(exc, exceptions.NotAuthenticated | exceptions.PermissionDenied) and "CSRF" in str(exc.detail):
            return error_response("csrf_failed", "Сессия устарела: обновите страницу.", 403)
        return error_response(str(code), MESSAGES.get(str(code), str(exc.detail)), response.status_code)
    return response
