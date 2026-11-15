"""Admin user CRUD, permissions, and last-admin protection."""

import os

from conftest import ADMIN_PASSWORD, USER_PASSWORD


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_admin_creates_and_lists_users(api, admin_headers, create_user):
    created = create_user(email="user@example.com", memory_scope="scope-1")
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["email"] == "user@example.com"
    assert body["role"] == "user"
    assert body["memory_scope"] == "scope-1"
    assert body["is_active"] is True
    assert "password_hash" not in body

    listed = api.get("/users", headers=admin_headers)
    assert listed.status_code == 200, listed.text
    users = listed.json()
    emails = {user["email"] for user in users}
    assert emails == {"admin@example.com", "user@example.com"}
    assert all("password_hash" not in user for user in users)


def test_create_user_validation(api, admin_headers, create_user):
    duplicate = create_user(email="user@example.com")
    assert duplicate.status_code == 201
    conflict = create_user(name="Other", email="user@example.com")
    assert conflict.status_code == 409

    short_password = api.post(
        "/users",
        json={"name": "Short", "email": "short@example.com", "password": "short"},
        headers=admin_headers,
    )
    assert short_password.status_code == 400

    second_admin = api.post(
        "/users",
        json={
            "name": "Second Admin",
            "email": "admin2@example.com",
            "password": ADMIN_PASSWORD,
            "role": "admin",
        },
        headers=admin_headers,
    )
    assert second_admin.status_code == 201, second_admin.text
    assert second_admin.json()["role"] == "admin"


def test_non_admin_cannot_manage_users(api, admin_headers, create_user, login):
    assert create_user(email="user@example.com").status_code == 201
    tokens = login("user@example.com", USER_PASSWORD)
    user_headers = _auth(tokens["access_token"])

    assert api.get("/users", headers=user_headers).status_code == 403
    assert (
        api.post(
            "/users",
            json={"name": "X", "email": "x@example.com", "password": USER_PASSWORD},
            headers=user_headers,
        ).status_code
        == 403
    )
    assert api.get("/users", headers=admin_headers).status_code == 200


def test_patch_user_fields_and_password(api, admin_headers, create_user, login):
    created = create_user(email="user@example.com").json()
    user_id = created["id"]

    patched = api.patch(
        f"/users/{user_id}",
        json={"name": "Renamed", "memory_scope": "scope-2", "is_active": True},
        headers=admin_headers,
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["name"] == "Renamed"
    assert body["memory_scope"] == "scope-2"

    # Clearing the scope via explicit null works.
    cleared = api.patch(f"/users/{user_id}", json={"memory_scope": None}, headers=admin_headers)
    assert cleared.status_code == 200
    assert cleared.json()["memory_scope"] is None

    password_change = api.patch(
        f"/users/{user_id}", json={"password": "brand-new-password"}, headers=admin_headers
    )
    assert password_change.status_code == 200, password_change.text

    assert api.post(
        "/auth/login", json={"email": "user@example.com", "password": USER_PASSWORD}
    ).status_code == 401
    assert api.post(
        "/auth/login", json={"email": "user@example.com", "password": "brand-new-password"}
    ).status_code == 200

    missing = api.patch("/users/00000000-0000-0000-0000-000000000000", json={"name": "x"}, headers=admin_headers)
    assert missing.status_code == 404


def test_cannot_demote_or_deactivate_last_admin(api, admin, admin_headers):
    demote = api.patch(f"/users/{admin['id']}", json={"role": "user"}, headers=admin_headers)
    assert demote.status_code == 400
    assert "last" in demote.json()["detail"].lower()

    deactivate = api.patch(f"/users/{admin['id']}", json={"is_active": False}, headers=admin_headers)
    assert deactivate.status_code == 400

    # The account is untouched by the rejected updates.
    me = api.get("/auth/me", headers=admin_headers).json()
    assert me["role"] == "admin" and me["is_active"] is True


def test_second_admin_enables_self_demotion(api, admin, admin_headers):
    second = api.post(
        "/users",
        json={
            "name": "Second Admin",
            "email": "admin2@example.com",
            "password": ADMIN_PASSWORD,
            "role": "admin",
        },
        headers=admin_headers,
    )
    assert second.status_code == 201, second.text

    demoted = api.patch(f"/users/{admin['id']}", json={"role": "user"}, headers=admin_headers)
    assert demoted.status_code == 200, demoted.text
    assert demoted.json()["role"] == "user"

    # The demoted caller's existing access token is now evaluated against the stored role.
    assert api.get("/users", headers=admin_headers).status_code == 403


def test_delete_user_and_protections(api, admin, admin_headers, create_user):
    created = create_user(email="user@example.com").json()
    user_id = created["id"]

    deleted = api.delete(f"/users/{user_id}", headers=admin_headers)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["message"]
    assert api.delete(f"/users/{user_id}", headers=admin_headers).status_code == 404

    self_delete = api.delete(f"/users/{admin['id']}", headers=admin_headers)
    assert self_delete.status_code == 400
    assert "own" in self_delete.json()["detail"].lower()


def test_admin_api_key_counts_as_admin_for_user_management(api, admin):
    """The legacy ADMIN_API_KEY path must be able to manage users too."""
    headers = {"X-API-Key": os.environ["ADMIN_API_KEY"]}
    listed = api.get("/users", headers=headers)
    assert listed.status_code == 200, listed.text
    assert any(user["email"] == "admin@example.com" for user in listed.json())
