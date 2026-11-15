"""Memory-scope enforcement for regular users, plus the admin-only endpoint matrix."""

from conftest import USER_PASSWORD


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _login_user(login, email="user@example.com"):
    return _auth(login(email, USER_PASSWORD)["access_token"])


def test_non_admin_cannot_list_all_memories(api, admin_headers, create_user, login, memory):
    assert create_user(email="user@example.com", memory_scope="u1").status_code == 201
    memory.seed("own", user_id="u1")
    memory.seed("other", user_id="u2")
    user_headers = _login_user(login)

    listed = api.get("/memories", headers=user_headers)
    assert listed.status_code == 403

    scoped = api.get("/memories", params={"user_id": "u1"}, headers=user_headers)
    assert scoped.status_code == 200, scoped.text
    assert [row["user_id"] for row in scoped.json()["results"]] == ["u1"]

    wrong_user = api.get("/memories", params={"user_id": "u2"}, headers=user_headers)
    assert wrong_user.status_code == 403

    # An agent/run filter alone is not enough: the scope must be pinned to user_id.
    agent_only = api.get("/memories", params={"agent_id": "a1"}, headers=user_headers)
    assert agent_only.status_code == 403

    both = api.get("/memories", params={"user_id": "u1", "agent_id": "missing"}, headers=user_headers)
    assert both.status_code == 200
    assert both.json()["results"] == []


def test_search_forces_scope(api, admin_headers, create_user, login, memory):
    assert create_user(email="user@example.com", memory_scope="u1").status_code == 201
    user_headers = _login_user(login)

    response = api.post(
        "/search",
        json={"query": "hello", "filters": {"user_id": "u2", "agent_id": "a1"}},
        headers=user_headers,
    )
    assert response.status_code == 200, response.text
    assert memory.search_calls[-1]["filters"]["user_id"] == "u1"
    # Other identifiers are preserved as filters.
    assert memory.search_calls[-1]["filters"]["agent_id"] == "a1"

    # The deprecated top-level user_id is overridden the same way.
    api.post("/search", json={"query": "hello", "user_id": "u2"}, headers=user_headers)
    assert memory.search_calls[-1]["filters"]["user_id"] == "u1"


def test_create_memory_forces_scope(api, admin_headers, create_user, login, memory):
    assert create_user(email="user@example.com", memory_scope="u1").status_code == 201
    user_headers = _login_user(login)

    created = api.post(
        "/memories",
        json={
            "messages": [{"role": "user", "content": "remember this"}],
            "user_id": "u2",
            "agent_id": "a1",
        },
        headers=user_headers,
    )
    assert created.status_code == 200, created.text
    call = memory.add_calls[-1]
    assert call["user_id"] == "u1"
    assert call["agent_id"] == "a1"

    # A scoped caller always has an implicit user_id, so no identifier is required.
    no_ids = api.post(
        "/memories",
        json={"messages": [{"role": "user", "content": "no explicit ids"}]},
        headers=user_headers,
    )
    assert no_ids.status_code == 200, no_ids.text
    assert memory.add_calls[-1]["user_id"] == "u1"


def test_single_memory_cross_user_is_404(api, admin_headers, create_user, login, memory):
    assert create_user(email="user@example.com", memory_scope="u1").status_code == 201
    own = memory.seed("own", user_id="u1")
    other = memory.seed("other", user_id="u2")
    user_headers = _login_user(login)

    assert api.get(f"/memories/{other}", headers=user_headers).status_code == 404
    assert api.put(f"/memories/{other}", json={"text": "hacked"}, headers=user_headers).status_code == 404
    assert api.delete(f"/memories/{other}", headers=user_headers).status_code == 404
    assert api.get(f"/memories/{other}/history", headers=user_headers).status_code == 404
    assert memory.delete_calls == []
    assert memory.update_calls == []

    got = api.get(f"/memories/{own}", headers=user_headers)
    assert got.status_code == 200
    assert got.json()["user_id"] == "u1"

    updated = api.put(f"/memories/{own}", json={"text": "new text"}, headers=user_headers)
    assert updated.status_code == 200, updated.text
    assert memory.update_calls[-1]["data"] == "new text"

    history = api.get(f"/memories/{own}/history", headers=user_headers)
    assert history.status_code == 200

    deleted = api.delete(f"/memories/{own}", headers=user_headers)
    assert deleted.status_code == 200

    # Unknown ids are also 404 (not 502) for scoped callers.
    assert api.get("/memories/does-not-exist", headers=user_headers).status_code == 404


def test_user_without_scope_is_denied(api, admin_headers, create_user, login):
    assert create_user(email="noscope@example.com", include_scope=False).status_code == 201
    user_headers = _login_user(login, email="noscope@example.com")

    assert api.get("/memories", params={"user_id": "u1"}, headers=user_headers).status_code == 403
    assert api.post("/search", json={"query": "x"}, headers=user_headers).status_code == 403
    assert api.get("/entities", headers=user_headers).status_code == 403


def test_admin_is_unrestricted(api, admin_headers, memory, login):
    memory.seed("one", user_id="u1")
    memory.seed("two", user_id="u2")
    other_id = memory.seed("agent", user_id="u2", agent_id="a1")

    everything = api.get("/memories", headers=admin_headers)
    assert everything.status_code == 200, everything.text
    assert len(everything.json()["results"]) == 3

    scoped = api.get("/memories", params={"user_id": "u2"}, headers=admin_headers)
    assert scoped.status_code == 200
    assert len(scoped.json()["results"]) == 2

    assert api.get(f"/memories/{other_id}", headers=admin_headers).status_code == 200

    searched = api.post("/search", json={"query": "x", "filters": {"user_id": "u2"}}, headers=admin_headers)
    assert searched.status_code == 200
    assert memory.search_calls[-1]["filters"]["user_id"] == "u2"

    updated = api.put(f"/memories/{other_id}", json={"text": "admin edit"}, headers=admin_headers)
    assert updated.status_code == 200

    assert api.delete(f"/memories/{other_id}", headers=admin_headers).status_code == 200


def test_admin_api_key_is_unrestricted(api, memory):
    import os

    memory.seed("one", user_id="u1")
    memory.seed("two", user_id="u2")
    response = api.get("/memories", headers={"X-API-Key": os.environ["ADMIN_API_KEY"]})
    assert response.status_code == 200, response.text
    assert len(response.json()["results"]) == 2


def test_entities_scope(api, admin_headers, create_user, login, memory):
    assert create_user(email="user@example.com", memory_scope="u1").status_code == 201
    memory.seed("own", user_id="u1")
    memory.seed("own2", user_id="u1", agent_id="a1")
    memory.seed("other", user_id="u2")
    user_headers = _login_user(login)

    scoped = api.get("/entities", headers=user_headers)
    assert scoped.status_code == 200, scoped.text
    entities = scoped.json()
    assert len(entities) == 1
    assert entities[0]["id"] == "u1"
    assert entities[0]["type"] == "user"
    assert entities[0]["total_memories"] == 2

    admin_view = api.get("/entities", headers=admin_headers)
    assert admin_view.status_code == 200
    pairs = {(entity["type"], entity["id"]) for entity in admin_view.json()}
    assert ("user", "u1") in pairs
    assert ("user", "u2") in pairs
    assert ("agent", "a1") in pairs

    # A scoped user with no memories at all gets an empty entity list.
    assert create_user(email="empty@example.com", memory_scope="u-empty").status_code == 201
    empty_headers = _login_user(login, email="empty@example.com")
    assert api.get("/entities", headers=empty_headers).json() == []


def test_admin_only_endpoints_reject_regular_users(api, admin_headers, create_user, login):
    assert create_user(email="user@example.com", memory_scope="u1").status_code == 201
    user_headers = _login_user(login)

    cases = [
        ("get", "/requests", None),
        ("get", "/usage/stats", None),
        ("post", "/configure", {}),
        ("post", "/decay", {"enabled": True}),
        ("post", "/expiry-default", {"days": None}),
        ("post", "/categories", {"custom_categories": []}),
        ("post", "/categories/test", {"text": "hello"}),
        ("post", "/reset", None),
        ("get", "/users", None),
        ("delete", "/memories", None),
    ]
    for method, path, body in cases:
        kwargs = {"headers": user_headers}
        if body is not None:
            kwargs["json"] = body
        response = getattr(api, method)(path, **kwargs)
        assert response.status_code == 403, f"{method.upper()} {path} -> {response.status_code} {response.text}"

    # Sanity check that the admin path itself still works for a couple of them.
    assert api.get("/requests", headers=admin_headers).status_code == 200


def test_admin_reset_uses_runtime(api, admin_headers, memory):
    response = api.post("/reset", headers=admin_headers)
    assert response.status_code == 200, response.text
    assert memory.reset_calls == 1
