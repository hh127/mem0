from collections import defaultdict
from datetime import datetime
from typing import Any, Literal, Optional

from auth import enforce_memory_scope, require_admin, verify_auth
from errors import upstream_error
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from schemas import MessageResponse
from server_state import get_memory_instance

router = APIRouter(prefix="/entities", tags=["entities"])

SCAN_LIMIT = 10_000

EntityType = Literal["user", "agent", "run"]
TYPE_TO_FIELD: dict[EntityType, str] = {"user": "user_id", "agent": "agent_id", "run": "run_id"}


class Entity(BaseModel):
    id: str
    type: EntityType
    total_memories: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


def _iter_payloads() -> list[dict[str, Any]]:
    results = get_memory_instance().vector_store.list(top_k=SCAN_LIMIT)
    rows = results[0] if results and isinstance(results, list) and isinstance(results[0], list) else results or []
    return [getattr(row, "payload", None) or {} for row in rows]


def _parse_timestamp(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _scoped_entities(scope: str) -> list[Entity]:
    """The single entity a non-admin may see: their own ``user`` scope."""
    bucket: dict[str, Any] = {"total_memories": 0, "created_at": None, "updated_at": None}
    for payload in _iter_payloads():
        # Agent/run entities are out of scope for non-admins, and so is any memory
        # owned by a different user.
        if payload.get("user_id") != scope:
            continue
        created = _parse_timestamp(payload.get("created_at"))
        updated = _parse_timestamp(payload.get("updated_at")) or created
        bucket["total_memories"] += 1
        if created and (bucket["created_at"] is None or created < bucket["created_at"]):
            bucket["created_at"] = created
        if updated and (bucket["updated_at"] is None or updated > bucket["updated_at"]):
            bucket["updated_at"] = updated

    if not bucket["total_memories"]:
        return []
    return [Entity(id=scope, type="user", **bucket)]


@router.get("", response_model=list[Entity])
def list_entities(request: Request, _auth=Depends(verify_auth)):
    """List every user/agent/run entity and its memory count.

    Admins see the full inventory. Non-admins get at most one row: their own ``user``
    entity (and an empty list when they have no memories yet).
    """
    scope = enforce_memory_scope(request, _auth)
    if scope is not None:
        return _scoped_entities(scope)

    buckets: dict[tuple[EntityType, str], dict[str, Any]] = defaultdict(
        lambda: {"total_memories": 0, "created_at": None, "updated_at": None}
    )

    for payload in _iter_payloads():
        created = _parse_timestamp(payload.get("created_at"))
        updated = _parse_timestamp(payload.get("updated_at")) or created

        for entity_type, field in TYPE_TO_FIELD.items():
            value = payload.get(field)
            if not value:
                continue
            bucket = buckets[(entity_type, str(value))]
            bucket["total_memories"] += 1
            if created and (bucket["created_at"] is None or created < bucket["created_at"]):
                bucket["created_at"] = created
            if updated and (bucket["updated_at"] is None or updated > bucket["updated_at"]):
                bucket["updated_at"] = updated

    return [
        Entity(id=entity_id, type=entity_type, **data)
        for (entity_type, entity_id), data in sorted(buckets.items(), key=lambda item: (item[0][0], item[0][1]))
    ]


@router.delete("/{entity_type}/{entity_id}", response_model=MessageResponse)
def delete_entity(entity_type: EntityType, entity_id: str, _auth=Depends(require_admin)):
    try:
        get_memory_instance().delete_all(**{TYPE_TO_FIELD[entity_type]: entity_id})
    except Exception:
        raise upstream_error()
    return MessageResponse(message="Entity deleted")
