"""Search-time memory decay (recency bias) for self-hosted mem0.

Platform parity note: the hosted Mem0 Platform ships a "Memory Decay" feature
that reinforces recently-retrieved memories and gently dampens stale ones at
search time. The stock OSS SDK raises ``ValueError`` when ``decay`` is passed
("The decay parameter is not supported by the OSS Memory SDK"). This module
implements the same behaviour natively for self-hosted deployments.

Design rules (deliberately matching the Platform's semantics):

  * Soft ranking bias, never a filter. The factor is clamped to
    [FLOOR, CEIL], so a stale memory can still surface for a strong match.
  * Nothing is ever deleted. Lifecycle cleanup stays with ``expiration_date``;
    this feature only reorders.
  * Access bookkeeping is written back fire-and-forget, so search latency is
    unaffected.

Enable with ``MEM0_DECAY=true``. While disabled, search behaviour is unchanged.

Tuning (all optional, read from the environment at call time):

  MEM0_DECAY_HALF_LIFE_DAYS  half-life of the recency curve (default 14)
  MEM0_DECAY_FLOOR           lowest scaling factor (default 0.3)
  MEM0_DECAY_CEIL            highest scaling factor (default 1.5)
  MEM0_DECAY_POOL_MULT       candidate over-fetch multiplier (default 3)
  MEM0_DECAY_POOL_MIN        minimum candidate pool (default 50)
  MEM0_DECAY_POOL_CAP        maximum candidate pool (default 200)
"""

import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

ACCESS_TS_KEY = "last_accessed_at"
ACCESS_COUNT_KEY = "access_count"
ACCESS_COUNT_CAP = 255

_TRUTHY = {"1", "true", "yes", "on"}


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in _TRUTHY


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def is_enabled() -> bool:
    """Whether decay is active. Read at call time so tests/toggles take effect."""
    return _env_bool("MEM0_DECAY", False)


def pool_size(limit: int) -> int:
    """Candidate pool to fetch before decay reorders and truncates.

    Decay can move a memory across the whole [FLOOR, CEIL] band, so it needs a
    deeper slice than ``limit`` to reorder within. Returns ``limit`` untouched
    while decay is disabled.
    """
    if not is_enabled():
        return limit
    mult = _env_int("MEM0_DECAY_POOL_MULT", 3)
    floor = _env_int("MEM0_DECAY_POOL_MIN", 50)
    cap = _env_int("MEM0_DECAY_POOL_CAP", 200)
    return max(limit, min(cap, max(limit * mult, floor)))


def _parse_ts(value: Any) -> Optional[datetime]:
    """Best-effort parse of an ISO string / epoch / datetime into aware UTC."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, bool):
        return None
    elif isinstance(value, (int, float)):
        try:
            dt = datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return None
    else:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _lookup(item: Dict[str, Any], key: str) -> Any:
    """Read a bookkeeping field from the top level or from ``metadata``."""
    if key in item:
        return item.get(key)
    metadata = item.get("metadata")
    if isinstance(metadata, dict):
        return metadata.get(key)
    return None


def decay_factor(item: Dict[str, Any], now: Optional[datetime] = None) -> float:
    """Scaling factor in [FLOOR, CEIL] derived from how recently a memory was used.

    Memories with no access history fall back to ``updated_at`` then
    ``created_at``. A memory with no usable timestamp at all is never
    penalised (returns CEIL).
    """
    floor = _env_float("MEM0_DECAY_FLOOR", 0.3)
    ceil = _env_float("MEM0_DECAY_CEIL", 1.5)
    half_life = _env_float("MEM0_DECAY_HALF_LIFE_DAYS", 14.0)
    if half_life <= 0:
        half_life = 14.0
    if ceil < floor:
        ceil = floor

    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    last_used = (
        _parse_ts(_lookup(item, ACCESS_TS_KEY))
        or _parse_ts(_lookup(item, "updated_at"))
        or _parse_ts(_lookup(item, "created_at"))
    )
    if last_used is None:
        return ceil

    days = (now - last_used).total_seconds() / 86400.0
    if days < 0:
        days = 0.0
    recency = 0.5 ** (days / half_life)
    return max(floor, min(ceil, floor + (ceil - floor) * recency))


def apply_decay(
    items: List[Dict[str, Any]],
    limit: int,
    now: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """Multiply each result's score by its decay factor, reorder, truncate.

    Ranking uses the *unclamped* product so the full [FLOOR, CEIL] band can
    rearrange candidates; the ``score`` handed back to callers is clamped to
    [0, 1] so the public API contract is preserved.
    """
    if not is_enabled() or not items:
        return items[:limit]

    now = now or datetime.now(timezone.utc)
    ranked = []
    for item in items:
        factor = decay_factor(item, now)
        try:
            base = float(item.get("score") or 0.0)
        except (TypeError, ValueError):
            base = 0.0

        enriched = dict(item)
        enriched["score"] = max(0.0, min(1.0, base * factor))
        details = enriched.get("score_details")
        if isinstance(details, dict):
            details = dict(details)
            details["decay_factor"] = factor
            details["score_before_decay"] = base
            enriched["score_details"] = details
        ranked.append((base * factor, enriched))

    # Stable sort: equal products keep their incoming (relevance) order.
    ranked.sort(key=lambda pair: pair[0], reverse=True)
    return [item for _, item in ranked[:limit]]


def record_access(items: List[Dict[str, Any]], vector_store: Any) -> None:
    """Fire-and-forget: bump access_count / last_accessed_at for returned memories.

    The payload is re-read before writing because ``vector_store.update``
    replaces the whole payload — writing back a partial dict would drop
    internal fields (``text_lemmatized``, ``hash``, ...).
    """
    if not is_enabled() or not items or vector_store is None:
        return

    ids = [str(item.get("id")) for item in items if item.get("id")]
    if not ids:
        return

    stamp = (datetime.now(timezone.utc)).isoformat()

    def _worker() -> None:
        for memory_id in ids:
            try:
                existing = vector_store.get(vector_id=memory_id)
                payload = dict(existing.payload) if existing and existing.payload else {}
                raw_count = payload.get(ACCESS_COUNT_KEY) or 0
                try:
                    count = int(raw_count)
                except (TypeError, ValueError):
                    count = 0
                payload[ACCESS_COUNT_KEY] = min(count + 1, ACCESS_COUNT_CAP)
                payload[ACCESS_TS_KEY] = stamp
                vector_store.update(vector_id=memory_id, payload=payload)
            except Exception as exc:  # never break a search over bookkeeping
                logger.debug("decay: could not record access for %s: %s", memory_id, exc)

    threading.Thread(target=_worker, name="mem0-decay-record", daemon=True).start()
