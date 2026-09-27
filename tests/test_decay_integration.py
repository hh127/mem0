"""End-to-end wiring tests: decay applied inside Memory.search().

Builds a bare Memory instance (no LLM / embedder / DB) and stubs the retrieval
layer, so these tests verify the wiring in main.py — the over-fetch, the
post-rerank placement, truncation, and the access write-back — not the decay
maths (covered by tests/test_decay.py).
"""

import copy
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

import mem0.memory.main as main_mod


NOW = datetime(2026, 9, 27, 12, 0, 0, tzinfo=timezone.utc)


def _iso(days_ago: float) -> str:
    return (NOW - timedelta(days=days_ago)).isoformat()


class FakeVectorStore:
    def __init__(self, payloads=None):
        self.payloads = {k: copy.deepcopy(v) for k, v in (payloads or {}).items()}
        self.updates = []

    def get(self, vector_id):
        payload = self.payloads.get(vector_id)
        if payload is None:
            return None
        return SimpleNamespace(id=vector_id, score=None, payload=copy.deepcopy(payload))

    def update(self, vector_id, vector=None, payload=None):
        self.updates.append({"vector_id": vector_id, "payload": payload})
        self.payloads[vector_id] = copy.deepcopy(payload)


@pytest.fixture
def quiet():
    """Silence telemetry + first-run notices so search() is quiet under test."""

    def _noop(*args, **kwargs):
        return None

    originals = {}
    for name in (
        "capture_event",
        "detect_temporal_usage_from_search",
        "detect_scale_threshold_from_top_k",
        "display_first_run_notice",
        "display_scale_threshold_notice",
        "display_performance_slow_query_notice",
        "display_temporal_usage_notice",
    ):
        if hasattr(main_mod, name):
            originals[name] = getattr(main_mod, name)
            setattr(main_mod, name, _noop)
    yield
    for name, fn in originals.items():
        setattr(main_mod, name, fn)


def _build_memory(results, store):
    """A Memory instance with only the attributes search() touches."""
    mem = main_mod.Memory.__new__(main_mod.Memory)
    mem.reranker = None
    mem.api_version = "v1.1"
    mem.vector_store = store
    calls = []

    def fake_search(query, filters, limit, threshold=0.1, explain=False, show_expired=False):
        calls.append(limit)
        return [dict(r) for r in results]

    mem._search_vector_store = fake_search
    return mem, calls


def _results():
    return [
        {"id": "stale", "memory": "old fact", "score": 0.9, "last_accessed_at": _iso(300)},
        {"id": "fresh", "memory": "new fact", "score": 0.5, "last_accessed_at": _iso(0)},
    ]


def _wait_for_updates(store, count, timeout=3.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if len(store.updates) >= count:
            return True
        time.sleep(0.01)
    return False


def test_search_decay_disabled_keeps_order_and_pool(monkeypatch, quiet):
    monkeypatch.delenv("MEM0_DECAY", raising=False)
    store = FakeVectorStore({"stale": {"data": "old fact"}, "fresh": {"data": "new fact"}})
    mem, calls = _build_memory(_results(), store)

    out = mem.search("query", filters={"user_id": "u1"}, top_k=2)["results"]

    assert [r["id"] for r in out] == ["stale", "fresh"]  # relevance order kept
    assert calls == [2]  # no over-fetch while disabled
    time.sleep(0.1)
    assert store.updates == []  # and no bookkeeping


def test_search_decay_reranks_returned_results(monkeypatch, quiet):
    monkeypatch.setenv("MEM0_DECAY", "true")
    store = FakeVectorStore({"stale": {"data": "old fact"}, "fresh": {"data": "new fact"}})
    mem, calls = _build_memory(_results(), store)

    out = mem.search("query", filters={"user_id": "u1"}, top_k=2)["results"]

    assert [r["id"] for r in out] == ["fresh", "stale"]  # decay flipped the order


def test_search_overfetches_candidate_pool(monkeypatch, quiet):
    monkeypatch.setenv("MEM0_DECAY", "true")
    store = FakeVectorStore()
    mem, calls = _build_memory(_results(), store)

    mem.search("query", filters={"user_id": "u1"}, top_k=5)

    assert calls == [50]  # max(5*3, POOL_MIN=50)


def test_search_truncates_back_to_top_k(monkeypatch, quiet):
    monkeypatch.setenv("MEM0_DECAY", "true")
    many = [
        {"id": str(i), "memory": f"fact {i}", "score": 0.9 - i * 0.01, "last_accessed_at": _iso(0)}
        for i in range(8)
    ]
    store = FakeVectorStore()
    mem, _ = _build_memory(many, store)

    out = mem.search("query", filters={"user_id": "u1"}, top_k=3)["results"]

    assert len(out) == 3


def test_search_records_access_for_returned_memories(monkeypatch, quiet):
    monkeypatch.setenv("MEM0_DECAY", "true")
    store = FakeVectorStore({"stale": {"data": "old fact"}, "fresh": {"data": "new fact"}})
    mem, _ = _build_memory(_results(), store)

    mem.search("query", filters={"user_id": "u1"}, top_k=2)

    assert _wait_for_updates(store, 2)
    recorded = {u["vector_id"] for u in store.updates}
    assert recorded == {"stale", "fresh"}
    for update in store.updates:
        assert update["payload"]["access_count"] == 1
        assert "last_accessed_at" in update["payload"]
        assert update["payload"]["data"]  # internal fields survived the write-back


def test_decay_runs_after_rerank(monkeypatch, quiet):
    """Reranker output must be the input to decay (platform ordering)."""
    monkeypatch.setenv("MEM0_DECAY", "true")
    store = FakeVectorStore()
    mem, _ = _build_memory(_results(), store)

    class FakeReranker:
        def rerank(self, query, documents, top_k=None):
            # Return reversed order with fresh scores -> decay must still apply
            return [
                {"id": "stale", "memory": "old fact", "score": 0.5, "last_accessed_at": _iso(300)},
                {"id": "fresh", "memory": "new fact", "score": 0.5, "last_accessed_at": _iso(0)},
            ]

    mem.reranker = FakeReranker()
    out = mem.search("query", filters={"user_id": "u1"}, top_k=2, rerank=True)["results"]

    # Equal rerank scores -> decay decides: fresh (1.5x) beats stale (0.3x)
    assert [r["id"] for r in out] == ["fresh", "stale"]
