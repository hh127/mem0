"""采集记忆系统三个模型（LLM / 嵌入 / 重排）的真实 token 用量。

为什么要拦到这么底层：mem0 内部拿到各家 API 的响应后，只取走自己需要的部分，
usage / meta.tokens 这些用量信息全被丢掉了，所以没有更高层的钩子可挂。

拦的是：
  - LLM 与嵌入：都走 openai SDK（chat.completions.create / embeddings.create），
    响应对象上带 usage；
  - 重排：CloudReranker 用 requests 直接 POST /rerank，响应的 meta.tokens.input_tokens
    里有用量（部分服务商放在 meta.billed_units）。

每次请求的 user_id / operation 靠 contextvar 传递：main.py 在中间件里按路径设置
operation，在各路由里补上 user_id（要读请求体，只能在路由内做）。

记录失败绝不影响主流程 —— 全部包在 try/except 里，只写日志。
"""

import contextvars
import hashlib
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

logger = logging.getLogger(__name__)

_usage_ctx: contextvars.ContextVar[dict] = contextvars.ContextVar(
    "mem0_usage_ctx", default={}
)

# 测试模型连通性等「非业务」调用不该污染用量统计：置位后 _record 直接丢弃。
_suppressed: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "mem0_usage_suppressed", default=False
)

# 「6 小时窗口」推断缓存的窗口长度（服务商不返回缓存字段时的兜底），可用环境变量调整。
CACHE_WINDOW_HOURS = float(os.environ.get("MEM0_CACHE_WINDOW_HOURS", "6") or 6)

# 缓存按 prompt 前缀命中，所以指纹只取前若干字符，避免每轮对话的尾部差异把命中打散。
_PROMPT_PREFIX_CHARS = int(os.environ.get("MEM0_CACHE_PROMPT_PREFIX_CHARS", "1500") or 1500)

# 模型类型常量
LLM = "llm"
EMBEDDER = "embedder"
RERANKER = "reranker"

_installed = False


# --------------------------------------------------------------------------- #
# 请求上下文
# --------------------------------------------------------------------------- #
def set_usage_context(**kwargs: Any) -> None:
    """往当前请求的上下文里塞 user_id / operation / request_id。"""
    ctx = dict(_usage_ctx.get())
    for key, value in kwargs.items():
        if value is not None:
            ctx[key] = value
    _usage_ctx.set(ctx)


def reset_usage_context() -> None:
    _usage_ctx.set({})


def current_usage_context() -> dict:
    return _usage_ctx.get()


def suppress_usage_recording() -> None:
    """临时停用用量采集（连通性测试、探活等调用不该进统计）。"""
    _suppressed.set(True)


def resume_usage_recording() -> None:
    _suppressed.set(False)


# --------------------------------------------------------------------------- #
# 落库
# --------------------------------------------------------------------------- #
def _record(
    model_type: str,
    model_name: Optional[str],
    prompt_tokens: Any = 0,
    completion_tokens: Any = 0,
    total_tokens: Any = None,
    cached_tokens: Any = 0,
    prompt_hash: Optional[str] = None,
) -> None:
    try:
        if _suppressed.get():
            return
        prompt = int(prompt_tokens or 0)
        completion = int(completion_tokens or 0)
        total = int(total_tokens) if total_tokens is not None else prompt + completion
        cached = int(cached_tokens or 0)
        if cached < 0:
            cached = 0
        if cached > prompt:
            cached = prompt
        if prompt == 0 and completion == 0 and total == 0:
            return

        # 延迟导入：模块被 main.py 导入时数据库可能还没准备好
        from db import SessionLocal
        from models import TokenUsage

        ctx = _usage_ctx.get()
        db = SessionLocal()
        try:
            db.add(
                TokenUsage(
                    model_type=model_type,
                    model_name=(model_name or "")[:128],
                    prompt_tokens=prompt,
                    completion_tokens=completion,
                    total_tokens=total,
                    cached_tokens=cached,
                    prompt_hash=prompt_hash,
                    operation=(ctx.get("operation") or "")[:32],
                    user_id=(str(ctx["user_id"])[:128] if ctx.get("user_id") else None),
                    request_id=(
                        str(ctx["request_id"])[:64] if ctx.get("request_id") else None
                    ),
                )
            )
            db.commit()
        finally:
            db.close()
    except Exception:
        logger.exception("Failed to record token usage")


def _prompt_fingerprint(messages: Any) -> Optional[str]:
    """给 prompt 取指纹，用于「窗口内出现过相同 prompt」的缓存推断。

    只取前缀若干字符：真实缓存是按前缀命中的，而每轮对话的尾部（用户新问题、
    抽取出的记忆正文）本来就不同，全量哈希会让命中几乎永远为 0。
    """
    if not messages:
        return None
    try:
        if isinstance(messages, str):
            text = messages
        else:
            text = json.dumps(messages, sort_keys=True, ensure_ascii=False)
    except Exception:
        try:
            text = str(messages)
        except Exception:
            return None
    prefix = text[:_PROMPT_PREFIX_CHARS]
    return hashlib.sha256(prefix.encode("utf-8", "ignore")).hexdigest()


def _cached_tokens_from_provider(usage: Any) -> Optional[int]:
    """读服务商返回的缓存命中字段（没有则返回 None，交给窗口推断）。"""
    if usage is None:
        return None

    # OpenAI 风格：usage.prompt_tokens_details.cached_tokens
    details = getattr(usage, "prompt_tokens_details", None)
    if details is None and isinstance(usage, dict):
        details = usage.get("prompt_tokens_details")
    if details is not None:
        if isinstance(details, dict):
            value = details.get("cached_tokens")
        else:
            value = getattr(details, "cached_tokens", None)
        if value is not None:
            return int(value)

    # DeepSeek 风格：顶层 prompt_cache_hit_tokens（新版 OpenAI SDK 落在 model_extra 里）
    for name in ("prompt_cache_hit_tokens", "cache_hit_tokens", "cached_tokens"):
        value = usage.get(name) if isinstance(usage, dict) else getattr(usage, name, None)
        if value is not None:
            return int(value)

    extra = getattr(usage, "model_extra", None)
    if isinstance(extra, dict):
        for name in ("prompt_cache_hit_tokens", "cache_hit_tokens", "cached_tokens"):
            if extra.get(name) is not None:
                return int(extra[name])
    return None


def _seen_within_cache_window(prompt_hash: Optional[str]) -> bool:
    """CACHE_WINDOW_HOURS 小时内是否已经出现过同一个 prompt（前缀）。"""
    if not prompt_hash:
        return False
    try:
        from sqlalchemy import select

        from db import SessionLocal
        from models import TokenUsage

        since = datetime.now(timezone.utc) - timedelta(hours=CACHE_WINDOW_HOURS)
        db = SessionLocal()
        try:
            row = db.execute(
                select(TokenUsage.id)
                .where(
                    TokenUsage.model_type == LLM,
                    TokenUsage.prompt_hash == prompt_hash,
                    TokenUsage.created_at >= since,
                )
                .limit(1)
            ).first()
            return row is not None
        finally:
            db.close()
    except Exception:
        logger.debug("cache-window lookup failed", exc_info=True)
        return False


def _model_of(payload: Any) -> Optional[str]:
    """从请求参数里取模型名（不同客户端传参形式不一样）。"""
    if isinstance(payload, dict):
        name = payload.get("model")
        if isinstance(name, str):
            return name
    if isinstance(payload, str):
        return payload
    return None


# --------------------------------------------------------------------------- #
# 安装钩子
# --------------------------------------------------------------------------- #
def _install_openai_hooks() -> None:
    try:
        from openai.resources.chat.completions import Completions
        from openai.resources.embeddings import Embeddings
    except Exception:  # pragma: no cover - openai 一定在
        logger.exception("usage hook: openai SDK not importable")
        return

    if not getattr(Completions, "_mem0_usage_patched", False):
        original_chat_create = Completions.create

        def chat_create(self, *args, **kwargs):
            response = original_chat_create(self, *args, **kwargs)
            try:
                usage = getattr(response, "usage", None)
                if usage is not None:
                    prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
                    model_name = _model_of(kwargs) or getattr(response, "model", None)
                    prompt_hash = _prompt_fingerprint(kwargs.get("messages"))
                    cached = _cached_tokens_from_provider(usage)
                    if cached is None:
                        # 服务商不回缓存字段：按「窗口内出现过相同 prompt」推断（整段 prompt 视为命中）
                        cached = prompt_tokens if _seen_within_cache_window(prompt_hash) else 0
                    _record(
                        LLM,
                        model_name,
                        prompt_tokens,
                        getattr(usage, "completion_tokens", 0),
                        getattr(usage, "total_tokens", None),
                        cached_tokens=cached,
                        prompt_hash=prompt_hash,
                    )
            except Exception:
                logger.exception("usage hook (chat completions) failed")
            return response

        chat_create._mem0_usage_patched = True  # type: ignore[attr-defined]
        Completions.create = chat_create

    if not getattr(Embeddings, "_mem0_usage_patched", False):
        original_embed_create = Embeddings.create

        def embed_create(self, *args, **kwargs):
            response = original_embed_create(self, *args, **kwargs)
            try:
                usage = getattr(response, "usage", None)
                if usage is not None:
                    _record(
                        EMBEDDER,
                        _model_of(kwargs) or getattr(response, "model", None),
                        getattr(usage, "prompt_tokens", 0),
                        0,
                        getattr(usage, "total_tokens", None),
                    )
            except Exception:
                logger.exception("usage hook (embeddings) failed")
            return response

        embed_create._mem0_usage_patched = True  # type: ignore[attr-defined]
        Embeddings.create = embed_create


def _install_requests_hook() -> None:
    """重排走的是裸 requests，按 URL 里的 /rerank 识别。"""
    try:
        import requests
    except Exception:  # pragma: no cover
        return

    if getattr(requests, "_mem0_usage_patched", False):
        return

    original_post = requests.post
    original_session_post = requests.Session.post

    def _extract_and_record(url: Any, json_body: Any, response: Any) -> None:
        try:
            if "/rerank" not in str(url) or not getattr(response, "ok", False):
                return
            data = response.json() or {}
            meta = data.get("meta") or {}
            tokens = meta.get("tokens") or meta.get("billed_units") or {}
            input_tokens = tokens.get("input_tokens", tokens.get("prompt_tokens", 0))
            output_tokens = tokens.get("output_tokens", tokens.get("completion_tokens", 0))
            _record(RERANKER, _model_of(json_body), input_tokens, output_tokens)
        except Exception:
            logger.exception("usage hook (rerank) failed")

    def post(url, *args, **kwargs):
        response = original_post(url, *args, **kwargs)
        _extract_and_record(url, kwargs.get("json"), response)
        return response

    def session_post(self, url, *args, **kwargs):
        response = original_session_post(self, url, *args, **kwargs)
        _extract_and_record(url, kwargs.get("json"), response)
        return response

    post._mem0_usage_patched = True  # type: ignore[attr-defined]
    session_post._mem0_usage_patched = True  # type: ignore[attr-defined]
    requests.post = post
    requests.Session.post = session_post
    requests._mem0_usage_patched = True  # type: ignore[attr-defined]


def install_usage_hooks() -> None:
    """在进程启动时调用一次。重复调用无副作用。"""
    global _installed
    if _installed:
        return
    _install_openai_hooks()
    _install_requests_hook()
    _installed = True
    logger.info("token usage hooks installed")
