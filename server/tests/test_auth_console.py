"""httpOnly cookie session for the Vite console, alongside the legacy body-token flow."""

import os
import subprocess
import sys
from pathlib import Path

from conftest import ADMIN_EMAIL, ADMIN_PASSWORD, USER_PASSWORD

COOKIE_NAME = "mem0_console_rt"
SERVER_DIR = Path(__file__).resolve().parents[1]


def _cookie_secure(extra_env: dict) -> str:
    """Resolve ``auth.CONSOLE_COOKIE_SECURE`` in a fresh interpreter (it is read at import)."""
    env = os.environ.copy()
    env.update(
        {
            "JWT_SECRET": "test-jwt-secret-0123456789abcdef0123456789abcdef",
            "AUTH_DISABLED": "false",
            **extra_env,
        }
    )
    proc = subprocess.run(
        [sys.executable, "-c", "import auth; print(auth.CONSOLE_COOKIE_SECURE)"],
        cwd=str(SERVER_DIR),
        env=env,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
    return proc.stdout.strip()


def _set_cookie(response) -> str:
    header = response.headers.get("set-cookie")
    assert header, "expected a Set-Cookie header"
    return header


def test_register_returns_tokens_and_http_only_cookie(api):
    response = api.post(
        "/auth/register",
        json={"name": "Admin", "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["access_token"] and body["refresh_token"]
    assert body["token_type"] == "bearer"

    cookie = _set_cookie(response)
    lowered = cookie.lower()
    assert f"{COOKIE_NAME}=" in cookie
    assert "httponly" in lowered
    assert "samesite=lax" in lowered
    assert "path=/" in lowered
    assert "max-age=2592000" in lowered  # 30 days
    assert "secure" not in lowered  # CONSOLE_COOKIE_SECURE=false in the test env


def test_login_sets_cookie_and_inactive_cookie_defaults(api):
    api.post(
        "/auth/register",
        json={"name": "Admin", "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    response = api.post("/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert response.status_code == 200, response.text
    assert f"{COOKIE_NAME}=" in _set_cookie(response)


def test_refresh_from_cookie_only(api):
    registered = api.post(
        "/auth/register",
        json={"name": "Admin", "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    ).json()
    old_refresh = registered["refresh_token"]

    # No body at all: the cookie jar from the register response carries the refresh token.
    response = api.post("/auth/refresh")
    assert response.status_code == 200, response.text
    rotated = response.json()
    assert rotated["refresh_token"] != old_refresh
    assert f"{COOKIE_NAME}=" in _set_cookie(response)

    # The rotated-away token is single-use and must no longer work (body replay).
    api.cookies.clear()
    replay = api.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert replay.status_code == 401


def test_refresh_from_body_still_works(api):
    registered = api.post(
        "/auth/register",
        json={"name": "Admin", "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    ).json()
    api.cookies.clear()

    response = api.post("/auth/refresh", json={"refresh_token": registered["refresh_token"]})
    assert response.status_code == 200, response.text
    assert response.json()["access_token"]

    again = api.post("/auth/refresh", json={"refresh_token": registered["refresh_token"]})
    assert again.status_code == 401

    api.cookies.clear()
    missing = api.post("/auth/refresh", json={})
    assert missing.status_code == 401


def test_logout_is_idempotent_and_revokes_refresh(api):
    registered = api.post(
        "/auth/register",
        json={"name": "Admin", "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    ).json()
    refresh = registered["refresh_token"]

    first = api.post("/auth/logout")
    assert first.status_code == 200
    assert first.json()["message"]
    assert "max-age=0" in _set_cookie(first).lower()

    second = api.post("/auth/logout")
    assert second.status_code == 200

    api.cookies.clear()
    after = api.post("/auth/refresh", json={"refresh_token": refresh})
    assert after.status_code == 401

    # Completely anonymous logout still succeeds.
    assert api.post("/auth/logout").status_code == 200


def test_logout_with_body_token(api):
    registered = api.post(
        "/auth/register",
        json={"name": "Admin", "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    ).json()
    api.cookies.clear()
    response = api.post("/auth/logout", json={"refresh_token": registered["refresh_token"]})
    assert response.status_code == 200
    assert api.post("/auth/refresh", json={"refresh_token": registered["refresh_token"]}).status_code == 401


def test_deactivated_user_cannot_login_refresh_or_use_access(api, admin_headers, create_user):
    created = create_user(email="user@example.com", memory_scope="u1")
    assert created.status_code == 201, created.text
    user_id = created.json()["id"]

    login = api.post("/auth/login", json={"email": "user@example.com", "password": USER_PASSWORD})
    assert login.status_code == 200, login.text
    tokens = login.json()

    deactivate = api.patch(f"/users/{user_id}", json={"is_active": False}, headers=admin_headers)
    assert deactivate.status_code == 200, deactivate.text

    blocked_login = api.post("/auth/login", json={"email": "user@example.com", "password": USER_PASSWORD})
    assert blocked_login.status_code == 401
    assert "invalid" in blocked_login.json()["detail"].lower()

    blocked_refresh = api.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert blocked_refresh.status_code == 401

    blocked_me = api.get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert blocked_me.status_code == 401


def test_me_exposes_user_fields(api, admin_headers):
    response = api.get("/auth/me", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["role"] == "admin"
    assert body["is_active"] is True
    assert body["memory_scope"] is None
    assert "password_hash" not in body


def test_cors_allows_configured_origins_with_credentials(api):
    allowed = api.options(
        "/auth/login",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert allowed.status_code == 200
    assert allowed.headers.get("access-control-allow-origin") == "http://localhost:5173"
    assert allowed.headers.get("access-control-allow-credentials") == "true"

    denied = api.options(
        "/auth/login",
        headers={
            "Origin": "http://evil.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert denied.headers.get("access-control-allow-origin") != "http://evil.example"


def test_cookie_secure_inference():
    https = {"DASHBOARD_URL": "https://mem0.example.com", "CONSOLE_COOKIE_SECURE": ""}
    http = {"DASHBOARD_URL": "http://localhost:3000", "CONSOLE_COOKIE_SECURE": ""}
    assert _cookie_secure(https) == "True"  # inferred from an https dashboard URL
    assert _cookie_secure(http) == "False"  # plain http dev stack

    assert _cookie_secure({**http, "CONSOLE_COOKIE_SECURE": "true"}) == "True"  # explicit wins
    assert _cookie_secure({**https, "CONSOLE_COOKIE_SECURE": "false"}) == "False"
