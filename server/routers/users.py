"""Admin-only user management for the multi-user console.

Regular accounts are created here (self-service registration only ever creates the
first admin). Every response is built from ``UserListItem``, so ``password_hash``
can never leak through this router.
"""

import uuid
from datetime import datetime
from typing import Literal

from auth import hash_password, require_admin, require_password_length
from db import get_db
from fastapi import APIRouter, Depends, HTTPException
from models import User
from pydantic import BaseModel, EmailStr, Field
from schemas import MessageResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

router = APIRouter(prefix="/users", tags=["users"])

Role = Literal["user", "admin"]
MAX_NAME_LENGTH = 255
MAX_SCOPE_LENGTH = 128


class UserListItem(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    role: str
    memory_scope: str | None = None
    is_active: bool = True
    created_at: datetime
    last_login_at: datetime | None = None

    model_config = {"from_attributes": True}


class CreateUserRequest(BaseModel):
    name: str = Field(..., max_length=MAX_NAME_LENGTH)
    email: EmailStr
    password: str
    role: Role = "user"
    memory_scope: str | None = Field(None, max_length=MAX_SCOPE_LENGTH)


class UpdateUserRequest(BaseModel):
    name: str | None = Field(None, max_length=MAX_NAME_LENGTH)
    role: Role | None = None
    memory_scope: str | None = Field(None, max_length=MAX_SCOPE_LENGTH)
    is_active: bool | None = None
    password: str | None = None


def _normalize_scope(value: str | None) -> str | None:
    scope = (value or "").strip()
    return scope or None


def _get_user_or_404(db: Session, user_id: str) -> User:
    try:
        parsed = uuid.UUID(str(user_id))
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="User not found.")
    user = db.get(User, parsed)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    return user


def _active_admin_count(db: Session, exclude_id: uuid.UUID | None = None) -> int:
    stmt = select(func.count(User.id)).where(User.role == "admin", User.is_active.is_(True))
    if exclude_id is not None:
        stmt = stmt.where(User.id != exclude_id)
    return db.scalar(stmt) or 0


def _admin_count(db: Session) -> int:
    return db.scalar(select(func.count(User.id)).where(User.role == "admin")) or 0


@router.get("", response_model=list[UserListItem])
def list_users(_auth=Depends(require_admin), db: Session = Depends(get_db)):
    """Every account; admin only (the list includes emails and scopes)."""
    users = db.execute(select(User).order_by(User.created_at.asc(), User.email.asc())).scalars().all()
    return users


@router.post("", response_model=UserListItem, status_code=201)
def create_user(
    body: CreateUserRequest,
    _auth=Depends(require_admin),
    db: Session = Depends(get_db),
):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty.")
    require_password_length(body.password)

    collision = db.scalar(select(User).where(User.email == body.email))
    if collision is not None:
        raise HTTPException(status_code=409, detail="Email is already in use.")

    user = User(
        name=name,
        email=body.email,
        password_hash=hash_password(body.password),
        role=body.role,
        memory_scope=_normalize_scope(body.memory_scope),
        is_active=True,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email is already in use.")
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserListItem)
def update_user(
    user_id: str,
    body: UpdateUserRequest,
    _auth=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Update profile fields, role, scope, activation, or password.

    The last active admin can be neither demoted nor deactivated: an installation with
    zero active admins would be unreachable through this API.
    """
    user = _get_user_or_404(db, user_id)
    fields = body.model_fields_set
    was_active_admin = user.role == "admin" and bool(user.is_active)

    if "name" in fields:
        name = (body.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty.")
        user.name = name

    if "role" in fields:
        if body.role is None:
            raise HTTPException(status_code=400, detail="role must be 'user' or 'admin'.")
        user.role = body.role

    if "memory_scope" in fields:
        user.memory_scope = _normalize_scope(body.memory_scope)

    if "is_active" in fields:
        if body.is_active is None:
            raise HTTPException(status_code=400, detail="is_active must be a boolean.")
        user.is_active = body.is_active

    if "password" in fields:
        if body.password is None:
            raise HTTPException(status_code=400, detail="password must be a string.")
        require_password_length(body.password)
        user.password_hash = hash_password(body.password)

    now_active_admin = user.role == "admin" and bool(user.is_active)
    if was_active_admin and not now_active_admin and _active_admin_count(db, exclude_id=user.id) == 0:
        db.rollback()
        raise HTTPException(status_code=400, detail="Cannot demote or deactivate the last active admin account.")

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="User update conflicts with an existing account.")
    db.refresh(user)
    return user


@router.delete("/{user_id}", response_model=MessageResponse)
def delete_user(
    user_id: str,
    _auth=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Hard-delete an account. API keys and refresh-token jtis cascade on the FK."""
    user = _get_user_or_404(db, user_id)
    current = _auth

    if current is not None and getattr(current, "id", None) == user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")

    if user.role == "admin" and _admin_count(db) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last admin account.")

    db.delete(user)
    db.commit()
    return MessageResponse(message="User deleted.")
