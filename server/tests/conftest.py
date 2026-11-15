"""Test fixtures for the self-hosted server.

The production stack is Postgres + a real mem0 runtime, neither of which is available to
unit tests. This conftest therefore:

1. sets every env var the server reads *before* importing ``main`` (JWT secret, cookie
   settings, ...), then
2. replaces the application database with a throw-away SQLite file and overrides
   ``get_db`` / every module-level ``SessionLocal`` binding, and
3. monkeypatches ``get_memory_instance`` with an in-memory fake mem0 runtime.

Run from ``server/`` with ``PYTHONPATH=. python -m pytest tests -q``.
"""

import os
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

# The server code is imported with `server/` as its root (``from auth import ...``). Allow
# the suite to be launched either from ``server/`` or from the repository root.
SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

_TMP_DIR = tempfile.mkdtemp(prefix="mem0-server-tests-")

# Everything below must be set before any server module is imported.
os.environ.update(
    {
        "JWT_SECRET": "test-jwt-secret-0123456789abcdef0123456789abcdef",
        # A long admin key keeps main.py's "no admin configured" DB probe out of startup.
        "ADMIN_API_KEY": "test-admin-api-key-0123456789abcdef",
        "AUTH_DISABLED": "false",
        "OPENAI_API_KEY": "sk-test-not-a-real-key",
        "HISTORY_DB_PATH": os.path.join(_TMP_DIR, "history.db"),
        # Point Postgres at a closed port so accidental connections fail fast instead of
        # hanging on DNS. Nothing under test may touch the real database.
        "POSTGRES_HOST": "127.0.0.1",
        "POSTGRES_PORT": "1",
        "POSTGRES_DB": "postgres",
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "postgres",
        "APP_DB_NAME": "mem0_app",
        "DASHBOARD_URL": "http://localhost:3000",
        "CONSOLE_COOKIE_NAME": "mem0_console_rt",
        "CONSOLE_COOKIE_SECURE": "false",
        "CORS_ORIGINS": "http://localhost:5173",
        "MEM0_TELEMETRY": "false",
    }
)

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import NullPool  # noqa: E402

import auth as auth_module  # noqa: E402
import main as app_main  # noqa: E402
import server_state  # noqa: E402
from db import Base, get_db  # noqa: E402
from rate_limit import limiter  # noqa: E402
from routers import entities as entities_module  # noqa: E402

DATABASE_PATH = os.path.join(_TMP_DIR, "app.db")
ENGINE = create_engine(
    f"sqlite:///{DATABASE_PATH}",
    connect_args={"check_same_thread": False, "timeout": 30},
    poolclass=NullPool,
)
TestingSessionLocal = sessionmaker(bind=ENGINE, autoflush=False, expire_on_commit=False)

# auth.verify_auth / require_admin open their own short-lived sessions through these
# bindings, so they must point at SQLite too (not only the FastAPI ``get_db`` dependency).
auth_module.SessionLocal = TestingSessionLocal
app_main.SessionLocal = TestingSessionLocal
server_state.set_session_factory(TestingSessionLocal)

# Request-log persistence is not under test and would add cross-thread writes to the
# single SQLite file; the middleware looks this name up at call time.
app_main._persist_request_log = lambda *args, **kwargs: None

# Rate limits are per-client-IP and would make consecutive tests flaky (register is
# 5/minute). They are covered by slowapi itself, not by these tests.
limiter.enabled = False

app = app_main.app


def _override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_get_db

ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "admin-password-123"
USER_PASSWORD = "user-password-123"


# --- Fake mem0 runtime --------------------------------------------------------


class FakeRow:
    """Mimics a vector-store row: ``.id`` plus ``.payload`` attributes."""

    def __init__(self, memory_id: str, payload: dict):
        self.id = memory_id
        self.payload = payload


class FakeVectorStore:
    def __init__(self, owner: "FakeMemory"):
        self.owner = owner

    def list(self, filters=None, top_k=100, **kwargs):
        rows = list(self.owner.rows.values())
        if filters:
            rows = [
                row
                for row in rows
                if all(row.payload.get(key) == value for key, value in filters.items())
            ]
        return [rows[:top_k]]


class FakeMemory:
    """Small in-memory stand-in exposing only the methods the REST layer calls."""

    def __init__(self):
        self.rows: dict[str, FakeRow] = {}
        self.vector_store = FakeVectorStore(self)
        self.add_calls: list[dict] = []
        self.search_calls: list[dict] = []
        self.update_calls: list[dict] = []
        self.delete_calls: list[str] = []
        self.reset_calls = 0
        self.history_calls: list[str] = []

    # helpers -------------------------------------------------------------
    def seed(self, data: str, **payload_fields) -> str:
        memory_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        payload = {"data": data, "created_at": now, "updated_at": now}
        payload.update({k: v for k, v in payload_fields.items() if v is not None})
        self.rows[memory_id] = FakeRow(memory_id, payload)
        return memory_id

    def _serialize(self, row: FakeRow) -> dict:
        payload = row.payload
        return {
            "id": row.id,
            "memory": payload.get("data"),
            "user_id": payload.get("user_id"),
            "agent_id": payload.get("agent_id"),
            "run_id": payload.get("run_id"),
            "created_at": payload.get("created_at"),
            "updated_at": payload.get("updated_at"),
        }

    def _filtered(self, filters):
        rows = list(self.rows.values())
        for key, value in (filters or {}).items():
            rows = [row for row in rows if row.payload.get(key) == value]
        return rows

    # mem0 Memory surface --------------------------------------------------
    def get(self, memory_id):
        row = self.rows.get(memory_id)
        return None if row is None else self._serialize(row)

    def get_all(self, *, filters=None, top_k=20, show_expired=False, **kwargs):
        return {"results": [self._serialize(row) for row in self._filtered(filters)[:top_k]]}

    def search(self, query, filters=None, **kwargs):
        self.search_calls.append({"query": query, "filters": dict(filters or {})})
        return {"results": [self._serialize(row) for row in self._filtered(filters)]}

    def add(self, messages, **params):
        self.add_calls.append({"messages": messages, **params})
        now = datetime.now(timezone.utc).isoformat()
        payload = {
            "data": messages[-1]["content"] if messages else "",
            "created_at": now,
            "updated_at": now,
        }
        for key in ("user_id", "agent_id", "run_id"):
            if params.get(key):
                payload[key] = params[key]
        payload.update(params.get("metadata") or {})
        memory_id = str(uuid.uuid4())
        self.rows[memory_id] = FakeRow(memory_id, payload)
        return {"results": [{"id": memory_id, "memory": payload["data"], "event": "ADD"}]}

    def update(self, memory_id, **params):
        self.update_calls.append({"memory_id": memory_id, **params})
        row = self.rows.get(memory_id)
        if row is None:
            raise ValueError(f"Memory with id {memory_id} not found")
        if params.get("data") is not None:
            row.payload["data"] = params["data"]
        if params.get("metadata"):
            row.payload.update(params["metadata"])
        return {"message": "Memory updated successfully!"}

    def delete(self, memory_id):
        self.delete_calls.append(memory_id)
        if memory_id not in self.rows:
            raise ValueError(f"Memory with id {memory_id} not found")
        del self.rows[memory_id]
        return {"message": "Memory deleted successfully!"}

    def delete_all(self, **filters):
        for row in self._filtered(filters):
            del self.rows[row.id]
        return {"message": "Memories deleted successfully!"}

    def reset(self):
        self.reset_calls += 1
        self.rows.clear()
        return {"message": "All memories reset"}

    def history(self, memory_id):
        self.history_calls.append(memory_id)
        return [{"id": memory_id, "event": "ADD", "old_memory": None, "new_memory": "x"}]


# --- Fixtures -----------------------------------------------------------------


@pytest.fixture(autouse=True)
def _fresh_database():
    """One empty schema per test (static SQLite file, dropped/recreated in between)."""
    Base.metadata.drop_all(bind=ENGINE)
    Base.metadata.create_all(bind=ENGINE)
    yield


@pytest.fixture(autouse=True)
def memory(monkeypatch):
    """Route every ``get_memory_instance`` binding to a fresh fake runtime."""
    fake = FakeMemory()
    for module in (app_main, server_state, entities_module):
        monkeypatch.setattr(module, "get_memory_instance", lambda: fake)
    return fake


@pytest.fixture
def api():
    with TestClient(app) as client:
        yield client


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin(api):
    response = api.post(
        "/auth/register",
        json={"name": "Admin", "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert response.status_code == 200, response.text
    tokens = response.json()
    tokens["email"] = ADMIN_EMAIL
    tokens["password"] = ADMIN_PASSWORD
    me = api.get("/auth/me", headers=_bearer(tokens["access_token"]))
    assert me.status_code == 200, me.text
    tokens["id"] = me.json()["id"]
    return tokens


@pytest.fixture
def admin_headers(admin):
    return _bearer(admin["access_token"])


@pytest.fixture
def create_user(api, admin_headers):
    """Create a regular user (or admin) through the admin API; returns the HTTP response."""

    def _create(
        *,
        name="User One",
        email="user@example.com",
        password=USER_PASSWORD,
        role="user",
        memory_scope=None,
        include_scope=True,
    ):
        payload = {"name": name, "email": email, "password": password, "role": role}
        if include_scope and memory_scope is not None:
            payload["memory_scope"] = memory_scope
        return api.post("/users", json=payload, headers=admin_headers)

    return _create


@pytest.fixture
def login(api):
    def _login(email: str, password: str):
        response = api.post("/auth/login", json={"email": email, "password": password})
        assert response.status_code == 200, response.text
        return response.json()

    return _login
