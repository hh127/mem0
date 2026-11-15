import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import (
    clear_refresh_cookie,
    consume_refresh_jti,
    create_access_token,
    create_refresh_token,
    decode_token,
    dummy_verify_password,
    hash_password,
    refresh_token_from_cookie,
    require_auth,
    require_password_length,
    set_refresh_cookie,
    verify_password,
)
from db import get_db
from models import User
from rate_limit import limiter
from schemas import MessageResponse
from telemetry import capture_admin_registered, capture_onboarding_completed

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str


class OnboardingCompleteRequest(BaseModel):
    use_case: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str | None = None


class LogoutRequest(BaseModel):
    refresh_token: str | None = None


class UpdateProfileRequest(BaseModel):
    name: str | None = None
    email: EmailStr | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    role: str
    memory_scope: str | None = None
    is_active: bool = True
    created_at: datetime

    model_config = {"from_attributes": True}


class SetupStatusResponse(BaseModel):
    needsSetup: bool


@router.get("/setup-status", response_model=SetupStatusResponse)
def setup_status(db: Session = Depends(get_db)):
    count = db.scalar(select(func.count(User.id)))
    return SetupStatusResponse(needsSetup=count == 0)


def _issue_tokens(response: Response, user: User, db: Session) -> TokenResponse:
    """Mint a token pair, set the console's httpOnly refresh cookie, and return the body.

    Both delivery channels are always populated: the dashboard keeps using the body
    tokens, the Vite console keeps the refresh token in the cookie only.
    """
    access_token = create_access_token(str(user.id), user.role)
    refresh_token = create_refresh_token(str(user.id), db)
    set_refresh_cookie(response, refresh_token)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/register", response_model=TokenResponse)
@limiter.limit("5/minute")
def register(request: Request, response: Response, body: RegisterRequest, db: Session = Depends(get_db)):
    """Create the first admin account. Blocked once any user exists.

    Additional accounts (regular users included) are created by an admin via ``POST /users``.
    """
    require_password_length(body.password)

    if db.scalar(select(func.count(User.id))) > 0:
        raise HTTPException(status_code=403, detail="Registration is closed. An admin account already exists.")

    user = User(
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        role="admin",
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=403, detail="Registration is closed. An admin account already exists.")
    db.refresh(user)

    capture_admin_registered(email=body.email)

    return _issue_tokens(response, user, db)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login(request: Request, response: Response, body: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email))
    if user is None:
        dummy_verify_password()
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    if not user.is_active:
        # Same generic message as a wrong password: never reveal that an account exists
        # but has been deactivated.
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()

    return _issue_tokens(response, user, db)


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("20/minute")
def refresh(
    request: Request,
    response: Response,
    body: RefreshRequest | None = None,
    db: Session = Depends(get_db),
):
    """Rotate a refresh token.

    The token is read from the JSON body first (dashboard), then from the console's
    httpOnly cookie. Either way the old jti is consumed and a fresh cookie is set.
    """
    token = (body.refresh_token if body and body.refresh_token else None) or refresh_token_from_cookie(request)
    if not token:
        raise HTTPException(status_code=401, detail="Refresh token is required.")

    payload = decode_token(token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type.")

    jti = payload.get("jti")
    if not jti:
        raise HTTPException(status_code=401, detail="Refresh token is no longer valid.")

    try:
        user_id = uuid.UUID(str(payload.get("sub")))
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token.")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found.")
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    consume_refresh_jti(jti, db)

    return _issue_tokens(response, user, db)


@router.post("/logout", response_model=MessageResponse)
def logout(
    request: Request,
    response: Response,
    body: LogoutRequest | None = None,
    db: Session = Depends(get_db),
):
    """Invalidate the caller's refresh token and clear the console cookie.

    Idempotent and unauthenticated on purpose: a missing, malformed, already-used or
    expired token still returns 200, so a client can always drop its session locally.
    """
    token = (body.refresh_token if body and body.refresh_token else None) or refresh_token_from_cookie(request)
    if token:
        try:
            payload = decode_token(token)
            jti = payload.get("jti")
            if payload.get("type") == "refresh" and jti:
                consume_refresh_jti(jti, db)
        except HTTPException:
            # Missing/expired/rotated token: logout is idempotent, so this is expected.
            logging.debug("Logout ignored an unusable refresh token")
        except Exception:
            logging.warning("Logout could not revoke the refresh token", exc_info=True)

    clear_refresh_cookie(response)
    return MessageResponse(message="Logged out.")


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(require_auth)):
    return user


@router.patch("/me", response_model=UserResponse)
def update_me(
    body: UpdateProfileRequest,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    # require_auth resolves the user in its own short-lived session, so `user` is
    # detached from this request's `db`. Load a session-managed copy to mutate.
    db_user = db.get(User, user.id)
    if db_user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    if body.name is not None and body.name.strip():
        db_user.name = body.name.strip()

    if body.email is not None and body.email != db_user.email:
        collision = db.scalar(select(User).where(User.email == body.email, User.id != db_user.id))
        if collision is not None:
            raise HTTPException(status_code=409, detail="Email is already in use.")
        db_user.email = body.email

    db.commit()
    return db_user


@router.post("/change-password", response_model=MessageResponse)
def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    # require_auth resolves the user in its own short-lived session, so `user` is
    # detached from this request's `db`. Load a session-managed copy to mutate.
    db_user = db.get(User, user.id)
    if db_user is None or not verify_password(body.current_password, db_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")

    require_password_length(body.new_password)

    db_user.password_hash = hash_password(body.new_password)
    db.commit()
    return MessageResponse(message="Password updated.")


@router.post("/onboarding-complete", response_model=MessageResponse)
def onboarding_complete(body: OnboardingCompleteRequest, user: User = Depends(require_auth)):
    """Fire the one-shot telemetry event after the setup wizard reaches its success state."""
    capture_onboarding_completed(email=user.email, use_case=body.use_case)
    return MessageResponse(message="Onboarding completed.")
