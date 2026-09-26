import os

from dotenv import load_dotenv

load_dotenv()
# mem0 官方遥测默认关闭：库在自己的模块加载时读取 MEM0_TELEMETRY，所以必须在
# `from mem0 import ...`（经 server_state 间接导入）之前把它落进 os.environ。
# .env 里显式写 MEM0_TELEMETRY=true 仍可打开（load_dotenv 先执行，setdefault 不覆盖已有值）。
os.environ.setdefault("MEM0_TELEMETRY", "false")

import asyncio
import json
import logging
import time
from typing import Any, Dict, List, Optional

import telemetry
from auth import ADMIN_API_KEY, AUTH_DISABLED, JWT_SECRET, require_admin, verify_auth
from db import SessionLocal
from errors import (
    UpstreamError,
    install_request_id_logging,
    new_request_id,
    request_id_var,
    upstream_error,
    upstream_error_handler,
)
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from models import RequestLog, User
from pydantic import BaseModel, Field
from rate_limit import limiter
from routers import api_keys as api_keys_router
from routers import auth as auth_router
from routers import entities as entities_router
from routers import requests as requests_router
from schemas import MessageResponse
from server_state import (
    get_current_config,
    get_memory_instance,
    initialize_state,
    set_session_factory,
    update_config,
)
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import func, select

from mem0.exceptions import ValidationError as Mem0ValidationError
from usage_hooks import (
    install_usage_hooks,
    reset_usage_context,
    resume_usage_recording,
    set_usage_context,
    suppress_usage_recording,
)

install_request_id_logging()
install_usage_hooks()
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - [%(request_id)s] %(message)s")

MIN_KEY_LENGTH = 16
SENSITIVE_CONFIG_KEYS = {
    "admin_api_key",
    "api_key",
    "authorization",
    "jwt_secret",
    "password",
    "password_hash",
    "secret",
    "token",
}
SKIPPED_REQUEST_LOG_PATHS = {"/api/health", "/docs", "/redoc", "/openapi.json"}
SKIPPED_REQUEST_LOG_PREFIXES = ("/requests",)

BUNDLED_LLM_PROVIDERS = ("openai", "anthropic", "gemini")
BUNDLED_EMBEDDER_PROVIDERS = ("openai", "gemini")


def _warn_if_unconfigured() -> None:
    """Pre-auth deployments upgrading into this build will 401 everywhere until
    an admin key or admin user exists. Surface the fix before the support tickets."""
    try:
        with SessionLocal() as session:
            if session.scalar(select(func.count(User.id))) > 0:
                return
    except Exception:
        return

    logging.warning(
        "\n%s\n"
        "  Auth is enabled by default and this server has no admin configured.\n"
        "  Protected endpoints will return 401 until you either:\n"
        "    1. Set ADMIN_API_KEY=<long-random-value>  (fastest, no client changes)\n"
        "    2. Register an admin at http://<host>:3000/setup\n"
        "    3. Set AUTH_DISABLED=true                 (local development only)\n"
        "  Docs: https://docs.mem0.ai/open-source/features/rest-api#authentication\n"
        "%s",
        "=" * 72,
        "=" * 72,
    )


if not AUTH_DISABLED and not JWT_SECRET:
    raise RuntimeError(
        "JWT_SECRET is required. Set it in .env (generate with `openssl rand -base64 48`) "
        "or set AUTH_DISABLED=true for local development only."
    )

if AUTH_DISABLED:
    logging.warning("AUTH_DISABLED is enabled. Protected endpoints are open for local development only.")
elif ADMIN_API_KEY and len(ADMIN_API_KEY) < MIN_KEY_LENGTH:
    logging.warning(
        "ADMIN_API_KEY is shorter than %d characters - consider using a longer key for production.",
        MIN_KEY_LENGTH,
    )
elif not ADMIN_API_KEY:
    _warn_if_unconfigured()

telemetry.log_status()

POSTGRES_HOST = os.environ.get("POSTGRES_HOST", "postgres")
POSTGRES_PORT = os.environ.get("POSTGRES_PORT", "5432")
POSTGRES_DB = os.environ.get("POSTGRES_DB", "postgres")
POSTGRES_USER = os.environ.get("POSTGRES_USER", "postgres")
POSTGRES_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "postgres")
POSTGRES_COLLECTION_NAME = os.environ.get("POSTGRES_COLLECTION_NAME", "memories")

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "")
EMBEDDER_BASE_URL = os.environ.get("EMBEDDER_BASE_URL", "")
EMBEDDER_API_KEY = os.environ.get("EMBEDDER_API_KEY", OPENAI_API_KEY)
HISTORY_DB_PATH = os.environ.get("HISTORY_DB_PATH", "/app/history/history.db")
DEFAULT_LLM_MODEL = os.environ.get("MEM0_DEFAULT_LLM_MODEL", "gpt-5-mini")
DEFAULT_EMBEDDER_MODEL = os.environ.get("MEM0_DEFAULT_EMBEDDER_MODEL", "text-embedding-3-small")

EMBEDDING_DIMS = int(os.environ.get("EMBEDDING_DIMS", "4096"))

# --- Optional reranker (third-party cloud rerank API) --------------------------
# Any provider registered in mem0.utils.factory.RerankerFactory may be used
# (cloud_reranker, llm_reranker, cohere, zero_entropy, huggingface,
# sentence_transformer). For provider="cloud_reranker" the simple env vars
# below are sufficient; for anything else set RERANKER_CONFIG_JSON instead.
RERANKER_PROVIDER = os.environ.get("RERANKER_PROVIDER", "").strip()
RERANKER_BASE_URL = os.environ.get("RERANKER_BASE_URL", "").strip()
RERANKER_API_KEY = os.environ.get("RERANKER_API_KEY", "").strip()
RERANKER_MODEL = os.environ.get("MEM0_DEFAULT_RERANKER_MODEL", "").strip()
RERANKER_TOP_K = int(os.environ.get("RERANKER_TOP_K", "3") or 3)
RERANKER_CONFIG_JSON = os.environ.get("RERANKER_CONFIG_JSON", "").strip()


def _build_reranker_config() -> Dict[str, Any]:
    """Build the optional reranker section of DEFAULT_CONFIG.

    Returns an empty dict when no reranker is configured, so the server keeps
    running without reranking (search still works, just without rescoring).
    """
    if RERANKER_CONFIG_JSON:
        try:
            return {"reranker": json.loads(RERANKER_CONFIG_JSON)}
        except json.JSONDecodeError as e:
            logging.warning("RERANKER_CONFIG_JSON is not valid JSON, ignoring: %s", e)
            return {}
    if not RERANKER_PROVIDER:
        return {}

    config: Dict[str, Any] = {"top_k": RERANKER_TOP_K}
    if RERANKER_BASE_URL:
        config["base_url"] = RERANKER_BASE_URL
    if RERANKER_API_KEY:
        config["api_key"] = RERANKER_API_KEY
    if RERANKER_MODEL:
        config["model"] = RERANKER_MODEL
    return {"reranker": {"provider": RERANKER_PROVIDER, "config": config}}


# v3 extraction (ADDITIVE_EXTRACTION_PROMPT) carries NO language instruction, so memories come out
# in ENGLISH even for Chinese input. Upstream ships a `use_input_language=True` block in
# mem0/configs/prompts.py but never wires it up at its call sites. This default keeps extraction
# in Chinese even when the Postgres `config_overrides` row is absent (fresh/reset DB, new host).
# Note: the DB override still wins when it sets custom_instructions.
DEFAULT_CUSTOM_INSTRUCTIONS = os.environ.get(
    "MEM0_CUSTOM_INSTRUCTIONS",
    "【语言要求 — 最重要】无论对话使用何种语言，记忆内容必须始终用【简体中文】书写，"
    "严禁翻译成英文。技术术语、产品型号、公司名、人名、专有名词保持输入中的原样形式。",
)

DEFAULT_CONFIG = {
    "version": "v1.1",
    "custom_instructions": DEFAULT_CUSTOM_INSTRUCTIONS,
    "vector_store": {
        "provider": "pgvector",
        "config": {
            "host": POSTGRES_HOST,
            "port": int(POSTGRES_PORT),
            "dbname": POSTGRES_DB,
            "user": POSTGRES_USER,
            "password": POSTGRES_PASSWORD,
            "collection_name": POSTGRES_COLLECTION_NAME,
            "embedding_model_dims": EMBEDDING_DIMS,
        },
    },
    "llm": {
        "provider": "openai",
        "config": {"api_key": OPENAI_API_KEY, "temperature": 0.2, "model": DEFAULT_LLM_MODEL, **({"openai_base_url": LLM_BASE_URL} if LLM_BASE_URL else {})},
    },
    "embedder": {"provider": "openai", "config": {"api_key": EMBEDDER_API_KEY, "model": DEFAULT_EMBEDDER_MODEL, **({"openai_base_url": EMBEDDER_BASE_URL} if EMBEDDER_BASE_URL else {})}},
    "history_db_path": HISTORY_DB_PATH,
    # Injected only when the RERANKER_* env vars are set.
    **_build_reranker_config(),
}


set_session_factory(SessionLocal)
initialize_state(DEFAULT_CONFIG)


app = FastAPI(
    title="Mem0 REST APIs",
    description=(
        "A REST API for managing and searching memories for your AI Agents and Apps.\n\n"
        "## Authentication\n"
        "Supports Bearer JWT tokens, per-user API keys via `X-API-Key` header, "
        "or the legacy `ADMIN_API_KEY` environment variable. Set `AUTH_DISABLED=true` for local development only."
    ),
    version="1.0.0",
    redirect_slashes=False,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_exception_handler(UpstreamError, upstream_error_handler)
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[DASHBOARD_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(api_keys_router.router)
app.include_router(entities_router.router)
app.include_router(requests_router.router)


class Message(BaseModel):
    role: str = Field(..., description="Role of the message (user or assistant).")
    content: str = Field(..., description="Message content.")


class MemoryCreate(BaseModel):
    messages: List[Message] = Field(..., description="List of messages to store.")
    user_id: Optional[str] = None
    agent_id: Optional[str] = None
    run_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    expiration_date: Optional[str] = Field(None, description="Expiration date in YYYY-MM-DD format.")
    infer: Optional[bool] = Field(None, description="Whether to extract facts from messages. Defaults to True.")
    memory_type: Optional[str] = Field(None, description="Type of memory to store (e.g. 'core').")
    prompt: Optional[str] = Field(None, description="Custom prompt to use for fact extraction.")


class MemoryUpdate(BaseModel):
    text: Optional[str] = Field(None, description="New content to update the memory with.")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Metadata to update.")
    expiration_date: Optional[str] = Field(None, description="Expiration date in YYYY-MM-DD format, or null to clear.")


class SearchRequest(BaseModel):
    query: str = Field(..., description="Search query.")
    user_id: Optional[str] = Field(None, description="Deprecated: pass inside `filters` instead.", deprecated=True)
    run_id: Optional[str] = Field(None, description="Deprecated: pass inside `filters` instead.", deprecated=True)
    agent_id: Optional[str] = Field(None, description="Deprecated: pass inside `filters` instead.", deprecated=True)
    filters: Optional[Dict[str, Any]] = None
    top_k: Optional[int] = Field(None, description="Maximum number of results to return.")
    threshold: Optional[float] = Field(None, description="Minimum similarity score for results.")
    explain: Optional[bool] = Field(None, description="Include score details for each search result.")
    rerank: Optional[bool] = Field(
        None,
        description="Rescore results with the configured reranker and return them reordered.",
    )
    show_expired: Optional[bool] = Field(None, description="Include expired memories.")


class GenerateInstructionsRequest(BaseModel):
    use_case: str = Field(..., description="Description of what the user will use Mem0 for.")


def _client_error(exc: Exception) -> HTTPException:
    """Map core validation / not-found errors to 4xx so clients can tell a bad
    request from an upstream outage. 'not found' is a 404, everything else a 400."""
    detail = str(exc)
    status_code = 404 if isinstance(exc, ValueError) and "not found" in detail.lower() else 400
    return HTTPException(status_code=status_code, detail=detail)


def _redact_config(value: Any, key: str | None = None) -> Any:
    if isinstance(value, dict):
        return {item_key: _redact_config(item_value, item_key) for item_key, item_value in value.items()}
    if isinstance(value, list):
        return [_redact_config(item_value, key) for item_value in value]
    if key is not None and key.lower() in SENSITIVE_CONFIG_KEYS:
        return "[redacted]" if value else value
    return value


def _validate_bundled_providers(config: Dict[str, Any]) -> None:
    llm = config.get("llm")
    if isinstance(llm, dict) and (provider := llm.get("provider")) and provider not in BUNDLED_LLM_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"LLM provider '{provider}' is not bundled in this image. "
                f"Bundled providers: {', '.join(BUNDLED_LLM_PROVIDERS)}. "
                "To use another provider, install its Python package, rebuild the container, "
                "and extend BUNDLED_LLM_PROVIDERS in server/main.py."
            ),
        )

    embedder = config.get("embedder")
    if (
        isinstance(embedder, dict)
        and (provider := embedder.get("provider"))
        and provider not in BUNDLED_EMBEDDER_PROVIDERS
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Embedder provider '{provider}' is not bundled in this image. "
                f"Bundled providers: {', '.join(BUNDLED_EMBEDDER_PROVIDERS)}. "
                "To use another provider, install its Python package, rebuild the container, "
                "and extend BUNDLED_EMBEDDER_PROVIDERS in server/main.py."
            ),
        )


def _should_log_request(request: Request) -> bool:
    if request.method == "OPTIONS":
        return False
    path = request.url.path
    if path in SKIPPED_REQUEST_LOG_PATHS:
        return False
    return not path.startswith(SKIPPED_REQUEST_LOG_PREFIXES)


def _persist_request_log(method: str, path: str, status_code: int, latency_ms: float, auth_type: str) -> None:
    session = SessionLocal()

    try:
        session.add(
            RequestLog(
                method=method,
                path=path,
                status_code=status_code,
                latency_ms=latency_ms,
                auth_type=auth_type,
            )
        )
        session.commit()
    except Exception:
        session.rollback()
        logging.exception("Failed to persist request log")
    finally:
        session.close()


def _operation_for_path(path: str, method: str) -> str:
    """把请求映射成用量统计里的操作维度。"""
    if path.startswith("/memories"):
        return {"POST": "add", "PUT": "update", "DELETE": "delete"}.get(method, "read")
    if path.startswith("/search"):
        return "search"
    return "other"


@app.middleware("http")
async def log_requests(request: Request, call_next):
    request.state.auth_type = getattr(request.state, "auth_type", "none")
    rid = new_request_id()
    token = request_id_var.set(rid)
    reset_usage_context()
    set_usage_context(operation=_operation_for_path(request.url.path, request.method), request_id=rid)
    start = time.perf_counter()
    status_code = 500

    try:
        response = await call_next(request)
        status_code = response.status_code
        response.headers["X-Request-ID"] = rid
        return response
    except Exception:
        status_code = 500
        raise
    finally:
        reset_usage_context()
        request_id_var.reset(token)
        if _should_log_request(request):
            asyncio.get_running_loop().run_in_executor(
                None,
                _persist_request_log,
                request.method,
                request.url.path,
                status_code,
                round((time.perf_counter() - start) * 1000, 2),
                getattr(request.state, "auth_type", "none"),
            )


@app.get("/configure", summary="Get current Mem0 configuration")
def get_config(_auth=Depends(verify_auth)):
    return _redact_config(get_current_config())


@app.get("/configure/providers", summary="List bundled LLM and embedder providers")
def list_bundled_providers(_auth=Depends(verify_auth)):
    return {"llm": list(BUNDLED_LLM_PROVIDERS), "embedder": list(BUNDLED_EMBEDDER_PROVIDERS)}


@app.post("/configure", summary="Configure Mem0")
def set_config(config: Dict[str, Any], _auth=Depends(require_admin)):
    """Set memory configuration. Requires admin role."""
    _validate_bundled_providers(config)
    update_config(config)
    return {"message": "Configuration set successfully"}


TEST_TARGETS = ("llm", "embedder", "reranker")


class ConfigureTestRequest(BaseModel):
    target: str = Field(..., description="Which model to test: llm | embedder | reranker.")
    config: Optional[Dict[str, Any]] = Field(
        None,
        description=(
            "Optional 'llm'/'embedder'/'reranker' section to test instead of the live one "
            "({provider, config}). Missing fields fall back to the effective config, so a "
            "half-filled form (e.g. only a new API key) can be tested before saving."
        ),
    )


def _merge_section(base: Any, override: Any) -> Dict[str, Any]:
    """Deep-merge a partial section over the effective one (never drops untouched fields)."""
    merged = dict(base) if isinstance(base, dict) else {}
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_section(merged[key], value)
        else:
            merged[key] = value
    return merged


def _shorten(value: Any, limit: int = 120) -> str:
    text = "" if value is None else str(value).strip().replace("\n", " ")
    return text[:limit] + ("…" if len(text) > limit else "")


def _run_model_probe(target: str, provider: str, config: Dict[str, Any]) -> str:
    """Make one real call to the given model and describe what came back."""
    if target == "llm":
        from mem0.utils.factory import LlmFactory

        llm = LlmFactory.create(provider, config)
        reply = llm.generate_response(messages=[{"role": "user", "content": "ping"}])
        return f"模型回复：{_shorten(reply) or '(空)'}"

    if target == "embedder":
        from mem0.utils.factory import EmbedderFactory

        embedder = EmbedderFactory.create(provider, config, None)
        vector = embedder.embed("连通性测试", "search")
        return f"返回向量维度 {len(vector)}"

    from mem0.utils.factory import RerankerFactory

    reranker = RerankerFactory.create(provider, config)
    ranked = reranker.rerank(
        "今天天气怎么样",
        [{"memory": "今天晴，气温 22 度"}, {"memory": "用户偏好简洁的回复"}],
    )
    score = (ranked[0] if ranked else {}).get("rerank_score")
    return f"返回 {len(ranked)} 条，首位得分 {score}"


@app.post("/configure/test", summary="Test one of the configured models for real")
def test_config_model(req: ConfigureTestRequest, _auth=Depends(require_admin)):
    """用真实调用探测 LLM / 嵌入 / 重排是否可用。

    只读不写：不发记忆、不改配置，探测期间的模型调用不计入用量统计。
    """
    target = (req.target or "").strip().lower()
    if target not in TEST_TARGETS:
        raise HTTPException(status_code=400, detail=f"target must be one of {list(TEST_TARGETS)}")

    section = _merge_section(get_current_config().get(target), req.config)
    provider = str(section.get("provider") or "").strip()
    raw_config = section.get("config")
    config = dict(raw_config) if isinstance(raw_config, dict) else {}
    if not provider:
        raise HTTPException(status_code=400, detail=f"{target} 尚未配置提供商（provider）")

    result: Dict[str, Any] = {
        "target": target,
        "provider": provider,
        "model": str(config.get("model") or ""),
        "ok": False,
        "latency_ms": 0,
        "detail": "",
        "error": None,
    }

    suppress_usage_recording()
    started = time.perf_counter()
    try:
        result["detail"] = _run_model_probe(target, provider, config)
        result["ok"] = True
    except Exception as exc:
        logging.warning("configure test failed for %s: %s", target, exc)
        result["error"] = _shorten(exc, 400)
    finally:
        result["latency_ms"] = int((time.perf_counter() - started) * 1000)
        resume_usage_recording()

    return result


@app.post("/generate-instructions", summary="Generate custom instructions from a use case")
def generate_instructions(req: GenerateInstructionsRequest, _auth=Depends(verify_auth)):
    """Generate custom instructions and a contextual test message tailored to a use case."""
    try:
        llm = get_memory_instance().llm
        prompt = (
            "You are configuring a memory system. Given the use case below, produce two things:\n"
            "1. INSTRUCTIONS: A short paragraph of custom instructions telling the memory extraction system "
            "what kinds of facts, preferences, and context to prioritize. Be specific to the use case.\n"
            "2. TEST_MESSAGE: A single realistic sentence a user in this use case would say, suitable for "
            "testing that the memory system works.\n\n"
            "Respond in exactly this format (no markdown, no extra text):\n"
            "INSTRUCTIONS: <your instructions>\n"
            f"TEST_MESSAGE: <your test message>\n\nUse case: {req.use_case}"
        )
        response = llm.generate_response([{"role": "user", "content": prompt}])
        instructions = response
        test_message = "I like to hike on weekends."
        if "INSTRUCTIONS:" in response and "TEST_MESSAGE:" in response:
            parts = response.split("TEST_MESSAGE:")
            instructions = parts[0].replace("INSTRUCTIONS:", "").strip()
            test_message = parts[1].strip()
        return {"custom_instructions": instructions, "test_message": test_message}
    except Exception:
        raise upstream_error()


@app.post("/memories", summary="Create memories")
def add_memory(memory_create: MemoryCreate, _auth=Depends(verify_auth)):
    """Store new memories."""
    if not any([memory_create.user_id, memory_create.agent_id, memory_create.run_id]):
        raise HTTPException(status_code=400, detail="At least one identifier (user_id, agent_id, run_id) is required.")

    params = {k: v for k, v in memory_create.model_dump().items() if v is not None and k != "messages"}
    set_usage_context(user_id=memory_create.user_id, operation="add")
    try:
        response = get_memory_instance().add(messages=[m.model_dump() for m in memory_create.messages], **params)
        if response.get("results"):
            telemetry.log_dashboard_nudge_once(DASHBOARD_URL)
        return JSONResponse(content=response)
    except (ValueError, Mem0ValidationError) as e:
        raise _client_error(e)
    except Exception:
        raise upstream_error()


ALL_MEMORIES_LIMIT = 1000
_RESERVED_PAYLOAD_KEYS = {"data", "user_id", "agent_id", "run_id", "hash", "created_at", "updated_at", "expiration_date"}


def _serialize_memory(row: Any) -> Dict[str, Any]:
    payload = getattr(row, "payload", None) or {}
    return {
        "id": getattr(row, "id", None),
        "memory": payload.get("data"),
        "user_id": payload.get("user_id"),
        "agent_id": payload.get("agent_id"),
        "run_id": payload.get("run_id"),
        "hash": payload.get("hash"),
        "expiration_date": payload.get("expiration_date"),
        "metadata": {k: v for k, v in payload.items() if k not in _RESERVED_PAYLOAD_KEYS},
        "created_at": payload.get("created_at"),
        "updated_at": payload.get("updated_at"),
    }


def _list_all_memories(limit: int = ALL_MEMORIES_LIMIT) -> Dict[str, Any]:
    results = get_memory_instance().vector_store.list(top_k=limit)
    rows = results[0] if results and isinstance(results, list) and isinstance(results[0], list) else results or []
    return {"results": [_serialize_memory(row) for row in rows]}


@app.get("/memories", summary="Get memories")
def get_all_memories(
    request: Request,
    user_id: Optional[str] = None,
    run_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    top_k: Optional[int] = Query(None, ge=0, le=ALL_MEMORIES_LIMIT),
    show_expired: bool = Query(False),
    _auth=Depends(verify_auth),
):
    """Retrieve stored memories. Lists all memories when no identifier is provided (admin only)."""
    try:
        if not any([user_id, run_id, agent_id]):
            auth_type = getattr(request.state, "auth_type", "none")
            if _auth is not None and _auth.role != "admin" and auth_type not in {"admin_api_key", "disabled"}:
                raise HTTPException(status_code=403, detail="Admin role required to list all memories.")
            # Admin all-memory listing is intentionally raw; scoped get_all below applies expiry visibility.
            return _list_all_memories(limit=top_k if top_k is not None else ALL_MEMORIES_LIMIT)
        filters = {
            k: v for k, v in {"user_id": user_id, "run_id": run_id, "agent_id": agent_id}.items() if v
        }
        params = {"filters": filters}
        if top_k is not None:
            params["top_k"] = top_k
        params["show_expired"] = show_expired
        return get_memory_instance().get_all(**params)
    except HTTPException:
        raise
    except Exception:
        raise upstream_error()


@app.get("/memories/{memory_id}", summary="Get a memory")
def get_memory(memory_id: str, _auth=Depends(verify_auth)):
    """Retrieve a specific memory by ID."""
    try:
        return get_memory_instance().get(memory_id)
    except Exception:
        raise upstream_error()


@app.post("/search", summary="Search memories")
def search_memories(search_req: SearchRequest, _auth=Depends(verify_auth)):
    """Search for memories based on a query."""
    try:
        filters = search_req.filters or {}
        deprecated_keys = []
        for entity_key in ("user_id", "agent_id", "run_id"):
            entity_val = getattr(search_req, entity_key, None)
            if entity_val:
                filters[entity_key] = entity_val
                deprecated_keys.append(entity_key)
        if deprecated_keys:
            logging.warning(
                "Top-level %s in /search is deprecated. Use filters={%s} instead.",
                ", ".join(deprecated_keys),
                ", ".join(f'"{k}": "..."' for k in deprecated_keys),
            )
        set_usage_context(user_id=filters.get("user_id"), operation="search")
        params = {}
        if search_req.top_k is not None:
            params["top_k"] = search_req.top_k
        if search_req.threshold is not None:
            params["threshold"] = search_req.threshold
        if search_req.explain is not None:
            params["explain"] = search_req.explain
        if search_req.rerank is not None:
            params["rerank"] = search_req.rerank
        if search_req.show_expired is not None:
            params["show_expired"] = search_req.show_expired
        return get_memory_instance().search(query=search_req.query, filters=filters, **params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception:
        raise upstream_error()


@app.put("/memories/{memory_id}", summary="Update a memory")
def update_memory(memory_id: str, updated_memory: MemoryUpdate, _auth=Depends(verify_auth)):
    """Update an existing memory."""
    try:
        fields_set = getattr(updated_memory, "model_fields_set", getattr(updated_memory, "__fields_set__", set()))
        params = {"memory_id": memory_id}
        if "text" in fields_set:
            params["data"] = updated_memory.text
        if "metadata" in fields_set:
            params["metadata"] = updated_memory.metadata
        if "expiration_date" in fields_set:
            params["expiration_date"] = updated_memory.expiration_date
        return get_memory_instance().update(**params)
    except (ValueError, Mem0ValidationError) as e:
        raise _client_error(e)
    except Exception:
        raise upstream_error()


@app.get("/memories/{memory_id}/history", summary="Get memory history")
def memory_history(memory_id: str, _auth=Depends(verify_auth)):
    """Retrieve memory history."""
    try:
        return get_memory_instance().history(memory_id=memory_id)
    except Exception:
        raise upstream_error()


@app.delete("/memories/{memory_id}", summary="Delete a memory", response_model=MessageResponse)
def delete_memory(memory_id: str, _auth=Depends(verify_auth)):
    """Delete a specific memory by ID."""
    try:
        get_memory_instance().delete(memory_id=memory_id)
        return MessageResponse(message="Memory deleted successfully")
    except (ValueError, Mem0ValidationError) as e:
        raise _client_error(e)
    except Exception:
        raise upstream_error()


@app.delete("/memories", summary="Delete all memories", response_model=MessageResponse)
def delete_all_memories(
    user_id: Optional[str] = None,
    run_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    _auth=Depends(require_admin),
):
    """Delete all memories for a given identifier. Requires admin role."""
    if not any([user_id, run_id, agent_id]):
        raise HTTPException(status_code=400, detail="At least one identifier is required.")
    try:
        params = {
            k: v for k, v in {"user_id": user_id, "run_id": run_id, "agent_id": agent_id}.items() if v
        }
        get_memory_instance().delete_all(**params)
        return MessageResponse(message="All relevant memories deleted")
    except Exception:
        raise upstream_error()


@app.post("/reset", summary="Reset all memories")
def reset_memory(_auth=Depends(require_admin)):
    """Completely reset stored memories. Requires admin role."""
    try:
        get_memory_instance().reset()
        return {"message": "All memories reset"}
    except Exception:
        raise upstream_error()


@app.get("/", summary="Redirect to the OpenAPI documentation", include_in_schema=False)
def home():
    """Redirect to the OpenAPI documentation."""
    return RedirectResponse(url="/docs")


USAGE_GROUPINGS = {"day", "month", "user", "operation", "model"}


@app.get("/usage/stats", summary="Token usage statistics")
def usage_stats(
    group_by: str = Query("day"),
    days: int = Query(30, ge=1, le=3650),
    model_type: Optional[str] = Query(None),
    _auth=Depends(verify_auth),
):
    """按天/月/用户/操作/模型聚合记忆系统的 token 消耗（LLM、嵌入、重排）。"""
    if group_by not in USAGE_GROUPINGS:
        raise HTTPException(status_code=400, detail=f"group_by must be one of {sorted(USAGE_GROUPINGS)}")

    from datetime import datetime, timedelta, timezone as _timezone

    from models import TokenUsage

    session = SessionLocal()
    try:
        # 按北京时间切分天/月，避免 UTC 造成跨日偏移
        local_time = func.timezone("Asia/Shanghai", TokenUsage.created_at)
        if group_by == "day":
            key_expr = func.to_char(local_time, "YYYY-MM-DD")
        elif group_by == "month":
            key_expr = func.to_char(local_time, "YYYY-MM")
        elif group_by == "user":
            key_expr = func.coalesce(TokenUsage.user_id, "(未标注)")
        elif group_by == "operation":
            key_expr = func.coalesce(func.nullif(TokenUsage.operation, ""), "(未标注)")
        else:
            key_expr = TokenUsage.model_type

        since = datetime.now(_timezone.utc) - timedelta(days=days)
        grouped = select(
            key_expr.label("key"),
            TokenUsage.model_type.label("model_type"),
            func.coalesce(func.sum(TokenUsage.prompt_tokens), 0).label("prompt_tokens"),
            func.coalesce(func.sum(TokenUsage.completion_tokens), 0).label("completion_tokens"),
            func.coalesce(func.sum(TokenUsage.total_tokens), 0).label("total_tokens"),
            func.coalesce(func.sum(TokenUsage.cached_tokens), 0).label("prompt_cached_tokens"),
            func.count().label("calls"),
        ).where(TokenUsage.created_at >= since)
        if model_type:
            grouped = grouped.where(TokenUsage.model_type == model_type)
        grouped = grouped.group_by(key_expr, TokenUsage.model_type).order_by(key_expr)
        rows = [dict(row._mapping) for row in session.execute(grouped)]

        totals_row = session.execute(
            select(
                func.coalesce(func.sum(TokenUsage.prompt_tokens), 0),
                func.coalesce(func.sum(TokenUsage.completion_tokens), 0),
                func.coalesce(func.sum(TokenUsage.total_tokens), 0),
                func.coalesce(func.sum(TokenUsage.cached_tokens), 0),
                func.count(),
            ).where(TokenUsage.created_at >= since)
        ).one()

        by_model = [
            {
                "model_type": row.model_type,
                "model_name": row.model_name or "",
                "calls": int(row.calls),
                "prompt_tokens": int(row.prompt_tokens),
                "completion_tokens": int(row.completion_tokens),
                "total_tokens": int(row.total_tokens),
                "prompt_cached_tokens": int(row.prompt_cached_tokens),
            }
            for row in session.execute(
                select(
                    TokenUsage.model_type,
                    func.max(TokenUsage.model_name).label("model_name"),
                    func.count().label("calls"),
                    func.coalesce(func.sum(TokenUsage.prompt_tokens), 0).label("prompt_tokens"),
                    func.coalesce(func.sum(TokenUsage.completion_tokens), 0).label("completion_tokens"),
                    func.coalesce(func.sum(TokenUsage.total_tokens), 0).label("total_tokens"),
                    func.coalesce(func.sum(TokenUsage.cached_tokens), 0).label("prompt_cached_tokens"),
                )
                .where(TokenUsage.created_at >= since)
                .group_by(TokenUsage.model_type)
                .order_by(func.sum(TokenUsage.total_tokens).desc())
            )
        ]
    finally:
        session.close()

    return {
        "group_by": group_by,
        "days": days,
        "rows": rows,
        "totals": {
            "prompt_tokens": int(totals_row[0]),
            "completion_tokens": int(totals_row[1]),
            "total_tokens": int(totals_row[2]),
            "prompt_cached_tokens": int(totals_row[3]),
            "calls": int(totals_row[4]),
        },
        "by_model": by_model,
    }
