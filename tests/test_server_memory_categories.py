"""PUT /memories/{id} 手工改分类标签的测试。

走 FastAPI TestClient 全 ASGI 往返，Memory 实例用 MagicMock 顶掉（不起真后端）。
覆盖：正常设置、与 metadata 共存、清空、未传时不动、非法形状 400、超量 400、归一化。
"""

import importlib
import os
from unittest.mock import MagicMock, patch

import pytest

pytest.importorskip("fastapi", reason="fastapi not installed")

# auth 模块在 import 期就要求 JWT_SECRET；本地/CI 用固定假值把它喂饱。
os.environ.setdefault("JWT_SECRET", "test-secret-" + "0" * 32)
os.environ.setdefault("AUTH_DISABLED", "true")
os.environ.setdefault("ADMIN_API_KEY", "")
os.environ.setdefault("OPENAI_API_KEY", "fake-key")

from fastapi.testclient import TestClient  # noqa: E402


def _load_app(env_overrides: dict):
    """按给定环境重载 server/main.py（auth/限流等都在 import 期读环境变量）。"""
    import server.main as server_main

    with patch.dict(os.environ, env_overrides, clear=False):
        importlib.reload(server_main)
    return server_main.app


@pytest.fixture(scope="module")
def app_client():
    """只 reload 一次 server.main（reload 会重导 mem0，很贵），mock 实例在模块内共用。"""
    instance = MagicMock()
    instance.update.return_value = {"message": "Memory updated successfully!"}
    with patch("mem0.Memory.from_config", return_value=instance):
        app = _load_app({"ADMIN_API_KEY": "", "AUTH_DISABLED": "true"})
        with TestClient(app) as client:
            yield client, instance


@pytest.fixture
def client(app_client):
    client, instance = app_client
    instance.reset_mock()  # 只清调用记录，保留 return_value
    return client


@pytest.fixture
def mock_memory(app_client):
    return app_client[1]


def _last_update_kwargs(mock):
    assert mock.update.call_args is not None, "update() 没被调用"
    return mock.update.call_args.kwargs


def test_set_categories_rides_metadata_merge(client, mock_memory):
    resp = client.put("/memories/mem-1", json={"categories": ["重要决策", "开发项目"]})
    assert resp.status_code == 200
    kwargs = _last_update_kwargs(mock_memory)
    assert kwargs["memory_id"] == "mem-1"
    assert kwargs["metadata"] == {"categories": ["重要决策", "开发项目"]}
    # 只改分类时不应该顺手改正文/到期日
    assert "data" not in kwargs
    assert "expiration_date" not in kwargs


def test_categories_merge_with_caller_metadata(client, mock_memory):
    resp = client.put(
        "/memories/mem-1",
        json={"metadata": {"source": "manual"}, "categories": ["个人偏好"]},
    )
    assert resp.status_code == 200
    assert _last_update_kwargs(mock_memory)["metadata"] == {
        "source": "manual",
        "categories": ["个人偏好"],
    }


def test_empty_list_clears_tags(client, mock_memory):
    resp = client.put("/memories/mem-1", json={"categories": []})
    assert resp.status_code == 200
    assert _last_update_kwargs(mock_memory)["metadata"] == {"categories": []}


def test_null_categories_clears_tags(client, mock_memory):
    resp = client.put("/memories/mem-1", json={"categories": None})
    assert resp.status_code == 200
    assert _last_update_kwargs(mock_memory)["metadata"] == {"categories": []}


def test_omitted_categories_leaves_tags_untouched(client, mock_memory):
    resp = client.put("/memories/mem-1", json={"text": "新正文"})
    assert resp.status_code == 200
    kwargs = _last_update_kwargs(mock_memory)
    assert kwargs["data"] == "新正文"
    assert "metadata" not in kwargs  # 不注入 categories


def test_names_are_trimmed_and_deduped(client, mock_memory):
    resp = client.put(
        "/memories/mem-1",
        json={"categories": ["  重要决策 ", "重要决策", "", "   ", "开发项目"]},
    )
    assert resp.status_code == 200
    assert _last_update_kwargs(mock_memory)["metadata"]["categories"] == ["重要决策", "开发项目"]


def test_wrong_type_is_rejected(client, mock_memory):
    """字符串而不是数组：pydantic 在校验层就挡掉（422），不会进业务逻辑。"""
    resp = client.put("/memories/mem-1", json={"categories": "重要决策"})
    assert resp.status_code == 422
    assert "categories" in resp.text
    mock_memory.update.assert_not_called()


def test_non_string_entry_is_rejected(client, mock_memory):
    resp = client.put("/memories/mem-1", json={"categories": ["重要决策", 42]})
    assert resp.status_code == 422
    assert "categories" in resp.text
    mock_memory.update.assert_not_called()


def test_too_many_categories_returns_400(client, mock_memory):
    import server.main as server_main

    limit = server_main.MAX_MANUAL_CATEGORIES
    resp = client.put("/memories/mem-1", json={"categories": [f"类{i}" for i in range(limit + 1)]})
    assert resp.status_code == 400
    mock_memory.update.assert_not_called()


def test_exactly_at_limit_is_accepted(client, mock_memory):
    import server.main as server_main

    limit = server_main.MAX_MANUAL_CATEGORIES
    resp = client.put("/memories/mem-1", json={"categories": [f"类{i}" for i in range(limit)]})
    assert resp.status_code == 200
    assert len(_last_update_kwargs(mock_memory)["metadata"]["categories"]) == limit


def test_text_and_categories_together(client, mock_memory):
    resp = client.put(
        "/memories/mem-1",
        json={"text": "改过正文", "categories": ["专业知识"]},
    )
    assert resp.status_code == 200
    kwargs = _last_update_kwargs(mock_memory)
    assert kwargs["data"] == "改过正文"
    assert kwargs["metadata"]["categories"] == ["专业知识"]


def test_expiration_and_categories_together(client, mock_memory):
    resp = client.put(
        "/memories/mem-1",
        json={"expiration_date": "2027-01-01", "categories": ["短期任务"]},
    )
    assert resp.status_code == 200
    kwargs = _last_update_kwargs(mock_memory)
    assert kwargs["expiration_date"] == "2027-01-01"
    assert kwargs["metadata"]["categories"] == ["短期任务"]
