from __future__ import annotations

import secrets
from typing import Any

import pytest
from django.contrib.auth.models import User
from django.core.management import call_command
from rest_framework.test import APIClient


@pytest.fixture(scope="session")
def django_db_setup(django_db_setup: Any, django_db_blocker: Any) -> None:
    with django_db_blocker.unblock():
        call_command("load_seed", verbosity=0)


@pytest.fixture(autouse=True)
def _clear_cache() -> None:
    from django.core.cache import cache

    cache.clear()


# Test passwords are generated per run: nothing that looks like a credential is stored in the repo.
TEST_PASSWORD = secrets.token_urlsafe(18)
OTHER_PASSWORD = secrets.token_urlsafe(18)
THIRD_PASSWORD = secrets.token_urlsafe(18)
WRONG_PASSWORD = secrets.token_urlsafe(18)


def make_client(email: str, password: str = TEST_PASSWORD) -> tuple[APIClient, dict[str, Any]]:
    client = APIClient()
    r = client.post("/api/auth/register/", {"email": email, "password": password, "name": email.split("@")[0]}, format="json")
    assert r.status_code == 201, r.content
    return client, r.json()


@pytest.fixture
def alice(db: Any) -> tuple[APIClient, dict[str, Any]]:
    return make_client("alice@example.com")


@pytest.fixture
def bob(db: Any) -> tuple[APIClient, dict[str, Any]]:
    return make_client("bob@example.com")


def household_id(user: dict[str, Any]) -> str:
    return user["households"][0]["id"]


def add_member(client: APIClient, hid: str, **kw: Any) -> dict[str, Any]:
    body = {"name": "Аня", "age": 34, "portion_mode": "simple", "portion_factor": 1, **kw}
    r = client.post(f"/api/households/{hid}/members/", body, format="json")
    assert r.status_code == 201, r.content
    return r.json()


__all__ = ["User", "add_member", "household_id", "make_client"]
