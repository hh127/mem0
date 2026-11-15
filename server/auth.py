import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from db import SessionLocal
from fastapi import Depends, HTTPException, Request, Response
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from models import APIKey, RefreshTokenJti, User
from passlib.context import CryptContext
from sqlalchemy import select, update
from sqlalchemy.orm import Session

JWT_SECRET = os.environ.get("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 30
ADMIN_API_KEY = os.environ.get("ADMIN_API_KEY", "")
AUTH_DISABLED = os.environ.get("AUTH_DISABLED", "").lower() in {"1", "true", "yes", "on"}
MIN_PASSWORD_LENGTH = 8

# --- Web console (Vite SPA behind a same-origin nginx proxy) -------------------
# The console keeps its refresh token in an httpOnly cookie. The body-token flow
# (dashboard) keeps working unchanged: every auth endpoint returns the tokens in
# the JSON body AND sets the cookie, so neither client depends on the other.
CONSOLE_COOKIE_NAME = os.environ.get("CONSOLE_COOKIE_NAME", "mem0_console_rt")
REFRESH_COOKIE_MAX_AGE = REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
DASHBOARD_URL = os.environ.get("DASHBOARD_URL", "http://localhost:3000")


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# Secure cookies require a TLS deployment. Infer from DASHBOARD_URL (https implies TLS)
# unless the operator pins the value explicitly with CONSOLE_COOKIE_SECURE.
CONSOLE_COOKIE_SECURE = _env_flag("CONSOLE_COOKIE_SECURE", DASHBOARD_URL.strip().lower().startswith("https://"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def dummy_verify_password() -> None:
    """Burn the same bcrypt cycles as a real verify so login timing doesn't leak whether an email exists."""
    pwd_context.dummy_verify()


def require_password_length(password: str) -> None:
    """Reject passwords shorter than the shared minimum (400, same rule everywhere)."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.",
        )


def generate_api_key() -> tuple[str, str, str]:
    """Returns (full_key, prefix, hash)."""
    raw = secrets.token_urlsafe(32)
    full_key = f"m0sk_{raw}"
    prefix = full_key[:12]
    key_hash = pwd_context.hash(full_key)
    return full_key, prefix, key_hash


def verify_api_key_hash(plain_key: str, hashed: str) -> bool:
    return pwd_context.verify(plain_key, hashed)


def _get_secret() -> str:
    if not JWT_SECRET:
        raise HTTPException(status_code=500, detail="JWT_SECRET is not configured.")
    return JWT_SECRET


def create_access_token(user_id: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": user_id, "role": role, "exp": expire, "type": "access"}
    return jwt.encode(payload, _get_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str, db: Session) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    jti = uuid.uuid4()
    db.add(RefreshTokenJti(jti=jti, user_id=uuid.UUID(user_id), expires_at=expire))
    db.commit()
    payload = {"sub": user_id, "exp": expire, "jti": str(jti), "type": "refresh"}
    return jwt.encode(payload, _get_secret(), algorithm=JWT_ALGORITHM)


def consume_refresh_jti(jti: str, db: Session) -> None:
    """Atomically mark a refresh token's jti as used. Raises 401 if missing, already used, or expired.

    The conditional UPDATE closes the read-check-write race: concurrent replays of the same
    token race on a single row, so at most one update affects a row and the rest see rowcount 0.
    """
    try:
        jti_uuid = uuid.UUID(jti)
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Refresh token is no longer valid.")
    now = datetime.now(timezone.utc)
    result = db.execute(
        update(RefreshTokenJti)
        .where(
            RefreshTokenJti.jti == jti_uuid,
            RefreshTokenJti.used_at.is_(None),
            RefreshTokenJti.expires_at > now,
        )
        .values(used_at=now)
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=401, detail="Refresh token is no longer valid.")
    db.commit()


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, _get_secret(), algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token.")


# --- httpOnly refresh-token cookie -------------------------------------------


def set_refresh_cookie(response: Response, refresh_token: str) -> None:
    """Attach the console's httpOnly refresh-token cookie to a successful auth response.

    SameSite=Lax (not None) because the console is served same-origin behind nginx; the
    body token flow never reads this cookie, so a CSRF-strict setting costs nothing.
    """
    response.set_cookie(
        key=CONSOLE_COOKIE_NAME,
        value=refresh_token,
        max_age=REFRESH_COOKIE_MAX_AGE,
        httponly=True,
        secure=CONSOLE_COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def clear_refresh_cookie(response: Response) -> None:
    """Expire the console cookie (used by /auth/logout)."""
    response.delete_cookie(
        key=CONSOLE_COOKIE_NAME,
        path="/",
        secure=CONSOLE_COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )


def refresh_token_from_cookie(request: Request) -> str | None:
    value = request.cookies.get(CONSOLE_COOKIE_NAME)
    return value or None


# --- Role / memory-scope helpers ---------------------------------------------


def is_admin_caller(request: Request, user: User | None) -> bool:
    """True for admin-role users and the legacy admin API key / AUTH_DISABLED paths.

    ``verify_auth`` returns ``None`` for the legacy paths, so the auth type recorded on
    ``request.state`` (not the returned user) decides their effective role.
    """
    if getattr(request.state, "auth_type", "none") in {"admin_api_key", "disabled"}:
        return True
    return user is not None and user.role == "admin"


def enforce_memory_scope(request: Request, user: User | None) -> str | None:
    """Return the memory scope a non-admin caller is confined to, or ``None`` for admins.

    A non-admin account without ``memory_scope`` cannot access any memory: failing closed
    is safer than treating a missing scope as "unrestricted".
    """
    if is_admin_caller(request, user):
        return None
    scope = (user.memory_scope or "").strip() if user is not None else ""
    if not scope:
        raise HTTPException(
            status_code=403,
            detail="This account has no memory scope assigned. Ask an administrator to set one.",
        )
    return scope


def memory_user_id(memory) -> str | None:
    """Extract the owning ``user_id`` from a Memory.get() dict or a vector-store row."""
    if memory is None:
        return None
    if isinstance(memory, dict):
        value = memory.get("user_id")
    else:
        payload = getattr(memory, "payload", None) or {}
        value = payload.get("user_id")
    return str(value) if value else None


bearer_scheme = HTTPBearer(auto_error=False)
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def _mark_auth_type(request: Request, auth_type: str) -> None:
    request.state.auth_type = auth_type


def _get_default_user(db: Session) -> User | None:
    return db.scalar(select(User).order_by(User.created_at.asc()))


def _uuid_from_token_sub(value) -> uuid.UUID | None:
    """JWT ``sub`` is a string; parse it before binding a UUID column (also works on SQLite)."""
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def _resolve_user_from_jwt(token: str, db: Session) -> User:
    payload = decode_token(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type.")
    user_id = _uuid_from_token_sub(payload.get("sub"))
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token.")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found.")
    if not user.is_active:
        # A deactivated account must lose API access immediately, not when its token expires.
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    return user


def _resolve_user_from_api_key(key: str, db: Session) -> User:
    prefix = key[:12] if len(key) >= 12 else key
    candidates = (
        db.execute(select(APIKey).where(APIKey.key_prefix == prefix, APIKey.revoked_at.is_(None))).scalars().all()
    )

    for candidate in candidates:
        if verify_api_key_hash(key, candidate.key_hash):
            candidate.last_used_at = datetime.now(timezone.utc)
            db.commit()
            user = db.get(User, candidate.created_by)
            if user is None:
                raise HTTPException(status_code=401, detail="API key owner not found.")
            if not user.is_active:
                raise HTTPException(status_code=401, detail="Invalid API key.")
            return user

    raise HTTPException(status_code=401, detail="Invalid API key.")


async def verify_auth(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    x_api_key: str | None = Depends(api_key_header),
) -> User | None:
    """Authenticate via JWT, X-API-Key, or legacy ADMIN_API_KEY. Returns User or None.

    A short-lived session is opened only on the branches that query the DB, so no
    pooled connection is held for the lifetime of the (possibly long-running) request.
    """
    if credentials is not None:
        _mark_auth_type(request, "bearer")
        with SessionLocal() as db:
            return _resolve_user_from_jwt(credentials.credentials, db)

    if x_api_key is not None:
        if ADMIN_API_KEY and secrets.compare_digest(x_api_key, ADMIN_API_KEY):
            _mark_auth_type(request, "admin_api_key")
            return None
        _mark_auth_type(request, "api_key")
        with SessionLocal() as db:
            return _resolve_user_from_api_key(x_api_key, db)

    if AUTH_DISABLED:
        _mark_auth_type(request, "disabled")
        return None

    raise HTTPException(
        status_code=401,
        detail="Authentication required. Provide a Bearer token or X-API-Key header.",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def require_auth(
    request: Request,
    user: User | None = Depends(verify_auth),
) -> User:
    """Like verify_auth but guarantees a non-None User. Use for endpoints that require auth."""
    if user is None:
        if getattr(request.state, "auth_type", "none") in {"admin_api_key", "disabled"}:
            with SessionLocal() as db:
                default_user = _get_default_user(db)
            if default_user is not None:
                return default_user
        raise HTTPException(status_code=401, detail="Authentication required.")
    return user


_BOOTSTRAP_ADMIN = User(
    id=uuid.UUID(int=0), name="admin_api_key", email="", password_hash="", role="admin", created_at=datetime.min.replace(tzinfo=timezone.utc),
)


async def require_admin(
    request: Request,
    user: User | None = Depends(verify_auth),
) -> User:
    """Like require_auth but also enforces admin role.

    ADMIN_API_KEY and AUTH_DISABLED callers are treated as admin even when
    the users table is empty (fresh-deploy bootstrap).
    """
    auth_type = getattr(request.state, "auth_type", "none")
    if user is None:
        if auth_type in {"admin_api_key", "disabled"}:
            with SessionLocal() as db:
                default_user = _get_default_user(db)
            if default_user is not None:
                if default_user.role != "admin":
                    raise HTTPException(status_code=403, detail="Admin role required.")
                return default_user
            return _BOOTSTRAP_ADMIN
        raise HTTPException(status_code=401, detail="Authentication required.")
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required.")
    return user
