import json
import logging
import os
import threading
from copy import deepcopy
from typing import Any, Callable, Dict

from mem0 import Memory

_state_lock = threading.RLock()
_current_config: Dict[str, Any] = {}
_memory_instance: Memory | None = None
_session_factory: Callable | None = None


def set_session_factory(factory: Callable) -> None:
    global _session_factory
    _session_factory = factory


def _load_overrides() -> Dict[str, Any]:
    try:
        if _session_factory is None:
            return {}
        from models import Settings

        session = _session_factory()
        try:
            row = session.get(Settings, "config_overrides")
            if row is None:
                return {}
            return json.loads(row.value)
        finally:
            session.close()
    except Exception:
        return {}


def _save_overrides(overrides: Dict[str, Any]) -> None:
    try:
        if _session_factory is None:
            return
        from models import Settings
        from sqlalchemy.dialects.postgresql import insert

        session = _session_factory()
        try:
            serialized = json.dumps(overrides)
            stmt = (
                insert(Settings)
                .values(key="config_overrides", value=serialized)
                .on_conflict_do_update(
                    index_elements=[Settings.key],
                    set_={"value": serialized},
                )
            )
            session.execute(stmt)
            session.commit()
        finally:
            session.close()
    except Exception:
        logging.warning("Failed to persist config overrides to database", exc_info=True)


def _load_setting(key: str) -> str | None:
    """Read a single settings row. Returns None when absent or the DB is unavailable."""
    try:
        if _session_factory is None:
            return None
        from models import Settings

        session = _session_factory()
        try:
            row = session.get(Settings, key)
            return row.value if row is not None else None
        finally:
            session.close()
    except Exception:
        return None


def _save_setting(key: str, value: str) -> None:
    """Upsert a single settings row (best-effort, same contract as _save_overrides)."""
    try:
        if _session_factory is None:
            return
        from models import Settings
        from sqlalchemy.dialects.postgresql import insert

        session = _session_factory()
        try:
            stmt = (
                insert(Settings)
                .values(key=key, value=value)
                .on_conflict_do_update(
                    index_elements=[Settings.key],
                    set_={"value": value},
                )
            )
            session.execute(stmt)
            session.commit()
        finally:
            session.close()
    except Exception:
        logging.warning("Failed to persist setting %s to database", key, exc_info=True)


# --- Search-time decay toggle -------------------------------------------------
# The mem0 library reads MEM0_DECAY from os.environ on every search (see
# mem0/memory/decay.py:is_enabled), so flipping the process env takes effect
# immediately — no Memory rebuild and no container restart required.

DECAY_SETTING_KEY = "decay_enabled"
_TRUTHY = {"1", "true", "yes", "on"}


def get_decay_enabled() -> bool:
    return os.environ.get("MEM0_DECAY", "").strip().lower() in _TRUTHY


def set_decay_enabled(enabled: bool) -> bool:
    os.environ["MEM0_DECAY"] = "true" if enabled else "false"
    _save_setting(DECAY_SETTING_KEY, "true" if enabled else "false")
    return enabled


def restore_decay_setting() -> None:
    """Re-apply the persisted toggle at startup; an unset row leaves the env alone."""
    raw = _load_setting(DECAY_SETTING_KEY)
    if raw is None:
        return
    os.environ["MEM0_DECAY"] = "true" if raw.strip().lower() in _TRUTHY else "false"


def _merge_config(base: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    merged = deepcopy(base)

    for key, value in updates.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_config(merged[key], value)
        else:
            merged[key] = value

    return merged


def initialize_state(default_config: Dict[str, Any]) -> None:
    global _current_config, _memory_instance
    restore_decay_setting()
    with _state_lock:
        _current_config = deepcopy(default_config)
        overrides = _load_overrides()
        if overrides:
            _current_config = _merge_config(_current_config, overrides)
        _memory_instance = Memory.from_config(_current_config)


def update_config(updates: Dict[str, Any]) -> Dict[str, Any]:
    global _current_config, _memory_instance
    with _state_lock:
        next_config = _merge_config(_current_config, updates)
        _current_config = next_config
        _memory_instance = Memory.from_config(next_config)
        overrides = _load_overrides()
        overrides = _merge_config(overrides, updates)
        _save_overrides(overrides)
        return deepcopy(_current_config)


def get_current_config() -> Dict[str, Any]:
    with _state_lock:
        return deepcopy(_current_config)


def get_memory_instance() -> Memory:
    with _state_lock:
        if _memory_instance is None:
            raise RuntimeError("Mem0 runtime has not been initialized.")
        return _memory_instance
