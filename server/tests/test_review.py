"""记忆人工审核：状态推导、metadata 保留字段与 POST /memories/{id}/review。"""

import pytest
from conftest import ADMIN_EMAIL, USER_PASSWORD

from review import (
    APPROVED,
    PENDING,
    REJECTED,
    memory_kind_of,
    review_patch,
    review_status_of,
    strip_review_metadata,
)


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# --- 纯逻辑 -------------------------------------------------------------------


def test_review_status_defaults_to_pending():
    assert review_status_of({}) == PENDING
    assert review_status_of({"metadata": {}}) == PENDING
    assert review_status_of({"metadata": None}) == PENDING
    assert review_status_of({"metadata": {"review_status": "unknown"}}) == PENDING
    # 两种返回形状都要认：SDK 把附加字段放进 metadata，管理端直接序列化平铺 payload。
    assert review_status_of({"metadata": {"review_status": APPROVED}}) == APPROVED
    assert review_status_of({"review_status": REJECTED}) == REJECTED


def test_memory_kind_uses_expiration_date():
    assert memory_kind_of(None) == "permanent"
    assert memory_kind_of("") == "permanent"
    assert memory_kind_of("2026-12-01") == "temporary"


def test_strip_review_metadata_removes_reserved_keys():
    original = {
        "source": "openclaw",
        "review_status": APPROVED,
        "reviewed_by": "admin@example.com",
        "reviewed_at": "2026-11-01T00:00:00+00:00",
        "review_note": "x",
    }
    assert strip_review_metadata(original) == {"source": "openclaw"}
    assert original["review_status"] == APPROVED, "调用方的 dict 不能被就地修改"
    assert strip_review_metadata(None) is None


def test_review_patch_sets_trace_and_clears_note():
    patch = review_patch("reject", "admin@example.com", "  重复内容  ")
    assert patch["review_status"] == REJECTED
    assert patch["reviewed_by"] == "admin@example.com"
    assert patch["review_note"] == "重复内容"
    assert patch["reviewed_at"]

    approved = review_patch("approve", "admin@example.com", "")
    assert approved["review_status"] == APPROVED
    assert approved["review_note"] is None


def test_review_patch_validation():
    with pytest.raises(ValueError):
        review_patch("maybe", "admin@example.com")
    with pytest.raises(ValueError):
        review_patch("approve", "admin@example.com", "x" * 501)


# --- REST 层 -------------------------------------------------------------------


def test_admin_can_approve_and_reject(api, admin_headers, memory):
    memory_id = memory.seed("用户偏好简洁的界面", user_id="u1")

    approved = api.post(
        f"/memories/{memory_id}/review", json={"action": "approve"}, headers=admin_headers
    )
    assert approved.status_code == 200, approved.text
    payload = memory.rows[memory_id].payload
    assert payload["review_status"] == APPROVED
    assert payload["reviewed_by"] == ADMIN_EMAIL
    assert payload["review_note"] is None

    rejected = api.post(
        f"/memories/{memory_id}/review",
        json={"action": "reject", "note": "重复内容"},
        headers=admin_headers,
    )
    assert rejected.status_code == 200, rejected.text
    payload = memory.rows[memory_id].payload
    assert payload["review_status"] == REJECTED
    assert payload["review_note"] == "重复内容"

    # 再次通过时清空上一次的驳回理由。
    api.post(f"/memories/{memory_id}/review", json={"action": "approve"}, headers=admin_headers)
    assert memory.rows[memory_id].payload["review_note"] is None


def test_review_errors(api, admin_headers, memory):
    memory_id = memory.seed("x", user_id="u1")

    missing = api.post("/memories/missing/review", json={"action": "approve"}, headers=admin_headers)
    assert missing.status_code == 404

    bad_action = api.post(
        f"/memories/{memory_id}/review", json={"action": "maybe"}, headers=admin_headers
    )
    assert bad_action.status_code == 400

    too_long = api.post(
        f"/memories/{memory_id}/review",
        json={"action": "reject", "note": "x" * 501},
        headers=admin_headers,
    )
    assert too_long.status_code == 422


def test_review_is_admin_only(api, admin_headers, create_user, login, memory):
    assert create_user(email="user@example.com", memory_scope="u1").status_code == 201
    memory_id = memory.seed("x", user_id="u1")
    headers = _auth(login("user@example.com", USER_PASSWORD)["access_token"])

    response = api.post(
        f"/memories/{memory_id}/review", json={"action": "approve"}, headers=headers
    )
    assert response.status_code == 403
    assert memory.update_calls == []


def test_create_and_update_strip_review_fields(api, admin_headers, memory):
    created = api.post(
        "/memories",
        json={
            "messages": [{"role": "user", "content": "记住这条"}],
            "user_id": "u1",
            "metadata": {"source": "test", "review_status": APPROVED},
        },
        headers=admin_headers,
    )
    assert created.status_code == 200, created.text
    assert memory.add_calls[-1]["metadata"] == {"source": "test"}

    memory_id = memory.seed("x", user_id="u1")
    updated = api.put(
        f"/memories/{memory_id}",
        json={"metadata": {"review_status": APPROVED, "tag": "keep"}},
        headers=admin_headers,
    )
    assert updated.status_code == 200, updated.text
    assert memory.update_calls[-1]["metadata"] == {"tag": "keep"}


def test_search_hides_rejected_memories(api, admin_headers, memory):
    rejected_id = memory.seed("旧偏好：喜欢深色界面", user_id="u1", review_status=REJECTED)
    pending_id = memory.seed("待审核偏好：喜欢浅色界面", user_id="u1")
    kept_id = memory.seed("新偏好：喜欢浅色界面", user_id="u1", review_status=APPROVED)

    response = api.post(
        "/search", json={"query": "界面", "filters": {"user_id": "u1"}}, headers=admin_headers
    )
    assert response.status_code == 200, response.text
    ids = [row["id"] for row in response.json()["results"]]
    assert rejected_id not in ids
    # 审核是后台动作：待审核的记忆仍然参与检索。
    assert pending_id in ids
    assert kept_id in ids

    # 管理列表仍能看到被驳回的记忆，方便恢复或彻底删除。
    listed = api.get("/memories", params={"user_id": "u1"}, headers=admin_headers)
    assert listed.status_code == 200, listed.text
    assert rejected_id in [row["id"] for row in listed.json()["results"]]
