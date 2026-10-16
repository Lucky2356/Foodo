from __future__ import annotations

from typing import Any

import pytest
from django.core import mail
from django.test import override_settings
from rest_framework.test import APIClient

from .conftest import add_member, household_id, make_client

pytestmark = pytest.mark.django_db


def test_csrf_is_enforced_for_session_requests() -> None:
    client = APIClient(enforce_csrf_checks=True)
    r = client.post("/api/auth/register/", {"email": "c@example.com", "password": "Sup3r-secret-pass"}, format="json")
    assert r.status_code == 403
    client.get("/api/auth/csrf/")
    token = client.cookies["csrftoken"].value
    r = client.post("/api/auth/register/", {"email": "c@example.com", "password": "Sup3r-secret-pass"}, format="json", HTTP_X_CSRFTOKEN=token)
    assert r.status_code == 201
    assert client.cookies["sessionid"]["httponly"]
    # Authenticated writes without the token are rejected too.
    hid = r.json()["households"][0]["id"]
    assert client.post(f"/api/households/{hid}/members/", {"name": "X"}, format="json").status_code == 403


def test_login_logout_and_wrong_password() -> None:
    make_client("dana@example.com")
    client = APIClient()
    assert (
        client.post("/api/auth/login/", {"email": "dana@example.com", "password": "nope-nope"}, format="json").json()["error"]["code"] == "invalid_credentials"
    )
    assert client.post("/api/auth/login/", {"email": "DANA@example.com", "password": "Sup3r-secret-pass"}, format="json").status_code == 200
    assert client.get("/api/auth/me/").status_code == 200
    r = client.post("/api/auth/logout/")
    assert r["Clear-Site-Data"] == '"cache"'
    assert client.get("/api/auth/me/").status_code == 403 or client.get("/api/auth/me/").status_code == 401


def test_login_is_rate_limited() -> None:
    make_client("eve@example.com")
    client = APIClient()
    codes = [client.post("/api/auth/login/", {"email": "eve@example.com", "password": "wrong-password"}, format="json").status_code for _ in range(12)]
    assert 429 in codes


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
def test_password_reset_flow() -> None:
    make_client("fay@example.com")
    client = APIClient()
    r = client.post("/api/auth/password/reset/", {"email": "fay@example.com"}, format="json")
    assert r.status_code == 200
    assert client.post("/api/auth/password/reset/", {"email": "nobody@example.com"}, format="json").json() == r.json()
    assert len(mail.outbox) == 1
    link = next(line for line in mail.outbox[0].body.splitlines() if "reset-password" in line)
    params = dict(p.split("=", 1) for p in link.split("?", 1)[1].split("&"))
    assert client.post("/api/auth/password/reset/confirm/", {**params, "password": "An0ther-secret-pass"}, format="json").status_code == 200
    assert client.post("/api/auth/password/reset/confirm/", {**params, "password": "Third-secret-pass1"}, format="json").status_code == 400
    assert client.post("/api/auth/login/", {"email": "fay@example.com", "password": "An0ther-secret-pass"}, format="json").status_code == 200


def test_user_cannot_touch_another_household(alice: Any, bob: Any) -> None:
    a_client, a_user = alice
    b_client, b_user = bob
    a_hid = household_id(a_user)
    member = add_member(a_client, a_hid)
    menu = a_client.post(f"/api/households/{a_hid}/menus/", {"start_date": "2026-10-19", "days": 2, "seed": 1}, format="json").json()
    pantry = a_client.post(f"/api/households/{a_hid}/pantry/", {"product_id": "potato", "qty": 300}, format="json").json()
    menu_id = menu["id"]
    batch_id = menu["menu"]["batches"][0]["id"]
    item_id = menu["menu"]["meals"][0]["items"][0]["id"]
    forbidden = [
        ("get", f"/api/households/{a_hid}/", None),
        ("patch", f"/api/households/{a_hid}/", {"name": "x"}),
        ("delete", f"/api/households/{a_hid}/", None),
        ("post", f"/api/households/{a_hid}/members/", {"name": "x"}),
        ("patch", f"/api/households/{a_hid}/members/{member['id']}/", {"name": "x"}),
        ("get", f"/api/households/{a_hid}/menus/", None),
        ("get", f"/api/households/{a_hid}/menus/{menu_id}/", None),
        ("post", f"/api/households/{a_hid}/menus/{menu_id}/ops/", {"op": {"op": "remove", "item_id": item_id}}),
        ("get", f"/api/households/{a_hid}/menus/{menu_id}/shopping/", None),
        ("patch", f"/api/households/{a_hid}/menus/{menu_id}/shopping/", {"marks": {}}),
        ("post", f"/api/households/{a_hid}/menus/{menu_id}/batches/{batch_id}/cook/", None),
        ("get", f"/api/households/{a_hid}/menus/{menu_id}/report/", None),
        ("get", f"/api/households/{a_hid}/pantry/", None),
        ("delete", f"/api/households/{a_hid}/pantry/{pantry['id']}/", None),
        ("get", f"/api/households/{a_hid}/prices/", None),
        ("get", f"/api/households/{a_hid}/water/?member_id={member['id']}", None),
        ("post", f"/api/households/{a_hid}/import-guest/", {"data": {}}),
    ]
    for method, url, body in forbidden:
        r = getattr(b_client, method)(url, body, format="json") if body is not None else getattr(b_client, method)(url)
        assert r.status_code == 404, (method, url, r.status_code)
    # Bob's own menu id inside Alice's household path is also invisible, and vice versa.
    b_hid = household_id(b_user)
    assert b_client.get(f"/api/households/{b_hid}/menus/{menu_id}/").status_code == 404
    # Nothing changed for Alice.
    assert a_client.get(f"/api/households/{a_hid}/pantry/").json()[0]["qty"] == 300
    anonymous = APIClient()
    assert anonymous.get(f"/api/households/{a_hid}/menus/{menu_id}/").status_code in (401, 403)


def test_viewer_can_read_but_not_write(alice: Any) -> None:
    a_client, a_user = alice
    hid = household_id(a_user)
    add_member(a_client, hid)
    token = a_client.post(f"/api/households/{hid}/invitations/", {"email": "viewer@example.com", "role": "viewer"}, format="json").json()["token"]
    v_client, _ = make_client("viewer@example.com")
    assert v_client.post("/api/invitations/accept/", {"token": token}, format="json").status_code == 200
    assert v_client.get(f"/api/households/{hid}/").status_code == 200
    r = v_client.post(f"/api/households/{hid}/members/", {"name": "Чужой"}, format="json")
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "permission_denied"
    # An invitation cannot be reused by somebody else.
    o_client, _ = make_client("other@example.com")
    assert o_client.post("/api/invitations/accept/", {"token": token}, format="json").status_code == 400


def test_account_export_and_delete(alice: Any) -> None:
    client, user = alice
    hid = household_id(user)
    add_member(client, hid)
    export = client.get("/api/account/export/").json()
    assert export["format"] == "foodo-account-export"
    assert export["households"][0]["members"][0]["name"] == "Аня"
    assert client.post("/api/account/delete/", {"password": "Sup3r-secret-pass"}, format="json").json()["error"]["code"] == "confirmation_required"
    assert client.post("/api/account/delete/", {"password": "Sup3r-secret-pass", "confirm": "УДАЛИТЬ"}, format="json").status_code == 200
    from households.models import Household

    assert not Household.objects.filter(pk=hid).exists()


def test_private_responses_are_not_cacheable(alice: Any) -> None:
    client, user = alice
    r = client.get(f"/api/households/{household_id(user)}/")
    assert r["Cache-Control"] == "no-store, private"
