"""Tests for search-time memory decay (mem0/memory/decay.py).

The module is loaded directly from its file so the suite runs without pulling
in mem0's runtime dependencies (vector stores / LLM providers) — decay itself
is pure stdlib.
"""

import copy
import importlib.util
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

DECAY_PATH = Path(__file__).resolve().parents[1] / "mem0" / "memory" / "decay.py"


def _load_decay():
    spec = importlib.util.spec_from_file_location("mem0_decay_under_test", DECAY_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


decay = _load_decay()

NOW = datetime(2026, 9, 27, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setenv("MEM0_DECAY", "true")
    return decay


@pytest.fixture
def disabled(monkeypatch):
    monkeypatch.delenv("MEM0_DECAY", raising=False)
    return decay


def _iso(days_ago: float) -> str:
    return (NOW - timedelta(days=days_ago)).isoformat()


# --------------------------------------------------------------------------
# enable / pool sizing
# --------------------------------------------------------------------------


def test_disabled_by_default(disabled):
    assert disabled.is_enabled() is False


def test_enabled_flag(enabled):
    assert enabled.is_enabled() is True


def test_pool_size_unchanged_when_disabled(disabled):
    assert disabled.pool_size(5) == 5
    assert disabled.pool_size(100) == 100


def test_pool_size_overfetches_when_enabled(enabled):
    # limit * 3 = 15 < POOL_MIN 50 -> 50
    assert enabled.pool_size(5) == 50
    # limit * 3 = 300 > POOL_CAP 200 -> 200
    assert enabled.pool_size(100) == 200
    # never below the requested limit
    assert enabled.pool_size(150) >= 150


# --------------------------------------------------------------------------
# scaling factor
# --------------------------------------------------------------------------


def test_factor_is_ceiling_for_fresh_memory(enabled):
    assert enabled.decay_factor({"last_accessed_at": _iso(0)}, NOW) == pytest.approx(1.5)


def test_factor_is_floor_for_stale_memory(enabled):
    factor = enabled.decay_factor({"last_accessed_at": _iso(365)}, NOW)
    assert factor == pytest.approx(0.3, abs=0.01)


def test_factor_follows_half_life(enabled):
    # One half-life of idle time => half of the band above the floor.
    expected = 0.3 + (1.5 - 0.3) * 0.5
    assert enabled.decay_factor({"last_accessed_at": _iso(14)}, NOW) == pytest.approx(expected, abs=0.01)


def test_factor_falls_back_to_updated_at(enabled):
    assert enabled.decay_factor({"updated_at": _iso(0)}, NOW) == pytest.approx(1.5)


def test_factor_falls_back_to_created_at(enabled):
    assert enabled.decay_factor({"created_at": _iso(0)}, NOW) == pytest.approx(1.5)


def test_factor_without_timestamp_is_not_penalised(enabled):
    assert enabled.decay_factor({}, NOW) == pytest.approx(1.5)
    assert enabled.decay_factor({"last_accessed_at": "not-a-date"}, NOW) == pytest.approx(1.5)


def test_prefers_access_time_over_updated_at(enabled):
    item = {"last_accessed_at": _iso(0), "updated_at": _iso(365)}
    assert enabled.decay_factor(item, NOW) == pytest.approx(1.5)


def test_factor_reads_metadata_nesting(enabled):
    item = {"metadata": {"last_accessed_at": _iso(0)}}
    assert enabled.decay_factor(item, NOW) == pytest.approx(1.5)


def test_factor_handles_naive_and_zulu_timestamps(enabled):
    naive = {"last_accessed_at": "2026-09-27T12:00:00"}
    zulu = {"last_accessed_at": "2026-09-27T12:00:00Z"}
    assert enabled.decay_factor(naive, NOW) == pytest.approx(1.5)
    assert enabled.decay_factor(zulu, NOW) == pytest.approx(1.5)


def test_factor_is_configurable(enabled, monkeypatch):
    monkeypatch.setenv("MEM0_DECAY_HALF_LIFE_DAYS", "1")
    # one day idle with a 1-day half-life => same as the 14-day case above
    assert enabled.decay_factor({"last_accessed_at": _iso(1)}, NOW) == pytest.approx(0.9, abs=0.01)


# --------------------------------------------------------------------------
# apply_decay: reorder / truncate / clamp
# --------------------------------------------------------------------------


def test_apply_decay_noop_when_disabled(disabled):
    items = [{"id": "a", "score": 0.9, "last_accessed_at": _iso(365)},
             {"id": "b", "score": 0.5, "last_accessed_at": _iso(0)}]
    out = disabled.apply_decay(items, limit=2, now=NOW)
    assert [i["id"] for i in out] == ["a", "b"]
    assert out[0]["score"] == 0.9


def test_apply_decay_reranks_stale_high_score_below_fresh(enabled):
    items = [{"id": "stale", "score": 0.9, "last_accessed_at": _iso(300)},
             {"id": "fresh", "score": 0.5, "last_accessed_at": _iso(0)}]
    out = enabled.apply_decay(items, limit=2, now=NOW)
    assert [i["id"] for i in out] == ["fresh", "stale"]


def test_apply_decay_truncates_to_limit(enabled):
    items = [{"id": str(i), "score": 0.5, "last_accessed_at": _iso(0)} for i in range(10)]
    out = enabled.apply_decay(items, limit=3, now=NOW)
    assert len(out) == 3


def test_apply_decay_clamps_public_score_to_unit_range(enabled):
    items = [{"id": "a", "score": 1.0, "last_accessed_at": _iso(0)}]
    out = enabled.apply_decay(items, limit=1, now=NOW)
    assert out[0]["score"] == 1.0  # 1.0 * 1.5 clamps back to 1.0


def test_apply_decay_does_not_mutate_input(enabled):
    items = [{"id": "a", "score": 0.5, "last_accessed_at": _iso(0)}]
    enabled.apply_decay(items, limit=1, now=NOW)
    assert items[0]["score"] == 0.5


def test_apply_decay_never_drops_below_threshold(enabled):
    """A decayed candidate that cleared the threshold still comes back."""
    items = [{"id": "a", "score": 0.11, "last_accessed_at": _iso(400)}]
    out = enabled.apply_decay(items, limit=1, now=NOW)
    assert len(out) == 1
    assert out[0]["score"] < 0.11  # dampened, but not filtered out


def test_apply_decay_adds_details_when_explain(enabled):
    items = [{"id": "a", "score": 0.5, "last_accessed_at": _iso(0),
              "score_details": {"final_score": 0.5}}]
    out = enabled.apply_decay(items, limit=1, now=NOW)
    assert out[0]["score_details"]["decay_factor"] == pytest.approx(1.5)
    assert out[0]["score_details"]["score_before_decay"] == pytest.approx(0.5)
    assert out[0]["score_details"]["final_score"] == 0.5  # original keys preserved


def test_apply_decay_handles_missing_score(enabled):
    out = enabled.apply_decay([{"id": "a", "last_accessed_at": _iso(0)}], limit=1, now=NOW)
    assert out[0]["score"] == 0.0


# --------------------------------------------------------------------------
# record_access
# --------------------------------------------------------------------------


class FakeVectorStore:
    def __init__(self, payloads):
        self.payloads = {k: copy.deepcopy(v) for k, v in payloads.items()}
        self.updates = []

    def get(self, vector_id):
        payload = self.payloads.get(vector_id)
        if payload is None:
            return None
        return SimpleNamespace(id=vector_id, score=None, payload=copy.deepcopy(payload))

    def update(self, vector_id, vector=None, payload=None):
        self.updates.append({"vector_id": vector_id, "vector": vector, "payload": payload})
        self.payloads[vector_id] = copy.deepcopy(payload)


def _wait_for_updates(store, count, timeout=3.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if len(store.updates) >= count:
            return True
        time.sleep(0.01)
    return False


BASE_PAYLOAD = {"data": "likes dark mode", "hash": "abc", "text_lemmatized": "like dark mode"}


def test_record_access_bumps_count_and_timestamp(enabled):
    store = FakeVectorStore({"m1": BASE_PAYLOAD})
    enabled.record_access([{"id": "m1"}], store)
    assert _wait_for_updates(store, 1)
    payload = store.updates[0]["payload"]
    assert payload["access_count"] == 1
    assert "last_accessed_at" in payload


def test_record_access_preserves_existing_fields(enabled):
    store = FakeVectorStore({"m1": BASE_PAYLOAD})
    enabled.record_access([{"id": "m1"}], store)
    assert _wait_for_updates(store, 1)
    payload = store.updates[0]["payload"]
    # update() replaces the whole payload, so internal fields must survive
    assert payload["data"] == BASE_PAYLOAD["data"]
    assert payload["hash"] == BASE_PAYLOAD["hash"]
    assert payload["text_lemmatized"] == BASE_PAYLOAD["text_lemmatized"]


def test_record_access_increments_existing_count(enabled):
    store = FakeVectorStore({"m1": {**BASE_PAYLOAD, "access_count": 7}})
    enabled.record_access([{"id": "m1"}], store)
    assert _wait_for_updates(store, 1)
    assert store.updates[0]["payload"]["access_count"] == 8


def test_record_access_caps_count(enabled):
    store = FakeVectorStore({"m1": {**BASE_PAYLOAD, "access_count": 255}})
    enabled.record_access([{"id": "m1"}], store)
    assert _wait_for_updates(store, 1)
    assert store.updates[0]["payload"]["access_count"] == 255


def test_record_access_tolerates_corrupt_count(enabled):
    store = FakeVectorStore({"m1": {**BASE_PAYLOAD, "access_count": "garbage"}})
    enabled.record_access([{"id": "m1"}], store)
    assert _wait_for_updates(store, 1)
    assert store.updates[0]["payload"]["access_count"] == 1


def test_record_access_noop_when_disabled(disabled):
    store = FakeVectorStore({"m1": BASE_PAYLOAD})
    disabled.record_access([{"id": "m1"}], store)
    time.sleep(0.1)
    assert store.updates == []


def test_record_access_noop_without_store(enabled):
    enabled.record_access([{"id": "m1"}], None)  # must not raise


def test_record_access_swallows_store_errors(enabled):
    class Broken:
        def get(self, vector_id):
            raise RuntimeError("db down")

        def update(self, **kwargs):
            raise AssertionError("should not be reached")

    enabled.record_access([{"id": "m1"}], Broken())  # must not raise
    time.sleep(0.1)


def test_record_access_handles_missing_memory(enabled):
    store = FakeVectorStore({})
    enabled.record_access([{"id": "ghost"}], store)
    assert _wait_for_updates(store, 1)
    # Nothing to read back, so it records a fresh payload rather than crashing.
    assert store.updates[0]["payload"]["access_count"] == 1
