"""记忆人工审核的纯逻辑。

审核状态直接存在记忆 payload 的平铺 metadata 里，不新增表、不迁移数据：

- 没有 ``review_status`` 字段 = 待审核；``approved`` / ``rejected`` 由审核接口写入。
- ``expiration_date`` 有值 = 临时记忆，空 = 永久记忆（复用已有的到期日语义）。
- ``reviewed_by`` / ``reviewed_at`` / ``review_note`` 是审核痕迹，仅作展示与追溯。

这里只放不依赖 FastAPI / mem0 运行时的函数，方便单测。
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Mapping, Optional

PENDING = "pending"
APPROVED = "approved"
REJECTED = "rejected"
REVIEW_STATUSES = (PENDING, APPROVED, REJECTED)

APPROVE_ACTION = "approve"
REJECT_ACTION = "reject"
REVIEW_ACTIONS = (APPROVE_ACTION, REJECT_ACTION)

REVIEW_STATUS_KEY = "review_status"
REVIEWED_BY_KEY = "reviewed_by"
REVIEWED_AT_KEY = "reviewed_at"
REVIEW_NOTE_KEY = "review_note"

#: 客户端写入记忆时会被剥掉的保留字段：审核结论只能由审核接口写。
REVIEW_METADATA_KEYS = frozenset({REVIEW_STATUS_KEY, REVIEWED_BY_KEY, REVIEWED_AT_KEY, REVIEW_NOTE_KEY})

KIND_TEMPORARY = "temporary"
KIND_PERMANENT = "permanent"

MAX_REVIEW_NOTE_LENGTH = 500


def _metadata_of(record: Optional[Mapping[str, Any]]) -> Mapping[str, Any]:
    """读取一条记忆的 metadata。

    记忆在两种形状里出现：SDK 返回的 ``{"metadata": {...}}``，以及管理端直接序列化
    payload 的平铺形状（``review_status`` 和 ``data`` 同级）。
    """
    if not isinstance(record, Mapping):
        return {}
    metadata = record.get("metadata")
    if isinstance(metadata, Mapping):
        return metadata
    return record


def review_status_of(record: Optional[Mapping[str, Any]]) -> str:
    """返回 ``pending`` / ``approved`` / ``rejected``；未知值按待审核处理。"""
    status = _metadata_of(record).get(REVIEW_STATUS_KEY)
    if status == APPROVED:
        return APPROVED
    if status == REJECTED:
        return REJECTED
    return PENDING


def memory_kind_of(expiration_date: Any) -> str:
    """有到期日 = 临时记忆；没有 = 永久记忆。"""
    if isinstance(expiration_date, str) and expiration_date.strip():
        return KIND_TEMPORARY
    return KIND_PERMANENT


def strip_review_metadata(metadata: Optional[Mapping[str, Any]]) -> Optional[Dict[str, Any]]:
    """从调用方提交的 metadata 里移除审核保留字段，防止绕过审核队列。"""
    if not isinstance(metadata, Mapping):
        return metadata
    return {key: value for key, value in metadata.items() if key not in REVIEW_METADATA_KEYS}


def review_patch(
    action: str,
    reviewer: Optional[str],
    note: Optional[str] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """构造一次审核要合并进 payload 的 metadata。

    ``note`` 为空时写入 ``None``，这样驳回后再次通过会清掉旧的驳回理由。
    """
    if action not in REVIEW_ACTIONS:
        raise ValueError(f"action must be one of {list(REVIEW_ACTIONS)}")

    note_text = (note or "").strip()
    if len(note_text) > MAX_REVIEW_NOTE_LENGTH:
        raise ValueError(f"note must be at most {MAX_REVIEW_NOTE_LENGTH} characters")

    timestamp = (now or datetime.now(timezone.utc)).isoformat()
    return {
        REVIEW_STATUS_KEY: APPROVED if action == APPROVE_ACTION else REJECTED,
        REVIEWED_BY_KEY: (reviewer or "").strip() or "unknown",
        REVIEWED_AT_KEY: timestamp,
        REVIEW_NOTE_KEY: note_text or None,
    }


def is_rejected(record: Optional[Mapping[str, Any]]) -> bool:
    return review_status_of(record) == REJECTED
