"""手动录入（infer=false）直写与显式分类标签：POST /memories。"""

from conftest import USER_PASSWORD
from review import APPROVED


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _payload(**overrides):
    """手动录入的默认请求体：直写 + 一条用户消息。"""
    body = {
        "messages": [{"role": "user", "content": "用户偏好深色主题"}],
        "user_id": "u1",
        "infer": False,
    }
    body.update(overrides)
    return body


def test_manual_entry_writes_raw_message_with_categories(api, admin_headers, memory):
    response = api.post(
        "/memories",
        json=_payload(categories=[" 技术偏好 ", "技术偏好", "", " 生活"]),
        headers=admin_headers,
    )
    assert response.status_code == 200, response.text
    call = memory.add_calls[-1]
    assert call["infer"] is False
    # 分类经 trim / 去空 / 去重后合并进 metadata，payload 侧仍是顶层 categories。
    assert call["metadata"]["categories"] == ["技术偏好", "生活"]


def test_categories_without_infer_is_rejected(api, admin_headers, memory):
    body = _payload(categories=["技术偏好"])
    body.pop("infer")

    response = api.post("/memories", json=body, headers=admin_headers)
    assert response.status_code == 400, response.text
    assert memory.add_calls == []


def test_categories_with_infer_true_is_rejected(api, admin_headers, memory):
    response = api.post(
        "/memories",
        json=_payload(infer=True, categories=["技术偏好"]),
        headers=admin_headers,
    )
    assert response.status_code == 400, response.text
    assert memory.add_calls == []


def test_categories_conflict_with_custom_categories(api, admin_headers, memory):
    response = api.post(
        "/memories",
        json=_payload(
            categories=["技术偏好"],
            custom_categories=[{"name": "技术偏好", "description": "技术类"}],
        ),
        headers=admin_headers,
    )
    assert response.status_code == 400, response.text
    assert memory.add_calls == []


def test_too_many_categories_is_rejected(api, admin_headers, memory):
    response = api.post(
        "/memories",
        json=_payload(categories=[f"分类{i}" for i in range(21)]),
        headers=admin_headers,
    )
    assert response.status_code == 400, response.text
    assert memory.add_calls == []


def test_manual_entry_scope_overrides_client_user_id(api, create_user, login, memory):
    assert create_user(email="user@example.com", memory_scope="u1").status_code == 201
    headers = _auth(login("user@example.com", USER_PASSWORD)["access_token"])

    response = api.post(
        "/memories",
        json=_payload(user_id="other", categories=["偏好"]),
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert memory.add_calls[-1]["user_id"] == "u1"


def test_manual_entry_defaults_to_pending_review(api, admin_headers, memory):
    response = api.post("/memories", json=_payload(), headers=admin_headers)
    assert response.status_code == 200, response.text
    memory_id = response.json()["results"][0]["id"]
    assert "review_status" not in memory.rows[memory_id].payload


def test_manual_entry_strips_review_fields_but_keeps_categories(api, admin_headers, memory):
    response = api.post(
        "/memories",
        json=_payload(
            metadata={"source": "manual", "review_status": APPROVED},
            categories=["偏好"],
        ),
        headers=admin_headers,
    )
    assert response.status_code == 200, response.text
    # 审核字段在合并分类之前被剥掉，categories 不会被 strip_review_metadata 误删。
    assert memory.add_calls[-1]["metadata"] == {"source": "manual", "categories": ["偏好"]}
