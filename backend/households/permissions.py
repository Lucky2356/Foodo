"""Household access. Every private endpoint resolves the household through the caller's
membership; a foreign id behaves exactly like a missing one (404), so ids cannot be probed."""

from __future__ import annotations

from django.http import Http404
from rest_framework.request import Request

from common.errors import ApiError

from .models import Household, Membership

READ = ("owner", "editor", "viewer")
WRITE = ("owner", "editor")
OWNER = ("owner",)


def household_for(request: Request, household_id: str, roles: tuple[str, ...] = READ) -> tuple[Household, str]:
    if not request.user.is_authenticated:
        raise ApiError("not_authenticated", "Войдите в аккаунт.", 401)
    membership = Membership.objects.select_related("household").filter(household_id=household_id, user=request.user).first() if _is_uuid(household_id) else None
    if membership is None:
        raise Http404
    if membership.role not in roles:
        raise ApiError("permission_denied", "Недостаточно прав для этого действия в семье.", 403)
    return membership.household, membership.role


def _is_uuid(value: str) -> bool:
    import uuid

    try:
        uuid.UUID(str(value))
    except ValueError:
        return False
    return True
