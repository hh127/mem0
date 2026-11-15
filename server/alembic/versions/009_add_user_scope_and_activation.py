"""Add user memory scope / activation; allow multiple admins

Revision ID: 009
Revises: 008
Create Date: 2026-11-15

多用户控制台所需的账号模型：

- ``users.memory_scope``：普通用户只能访问 user_id 等于该值的记忆；NULL 表示未分配
  （非管理员没有作用域时一律拒绝访问）。
- ``users.is_active``：停用账号后登录/刷新/已签发的 access token 立即失效。

同时删除 004 建立的「最多一个 admin」部分唯一索引。``POST /users`` 允许创建第二个
admin，因此「不能降级/停用/删除最后一个 admin」改由 API 层保证（见 routers/users.py）；
如果继续保留该索引，第二个 admin 会在数据库层直接被拒绝。

Downgrade 会先检查 admin 数量：存在多个 admin 时直接报错（不改动任何列），因为
重建部分唯一索引必然失败。
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("memory_scope", sa.String(128), nullable=True))
    op.add_column(
        "users",
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    # 004's partial unique index would reject a second admin account, which the
    # admin-managed user API now allows. Last-admin protection lives in the API layer.
    op.drop_index("ix_users_only_one_admin", table_name="users")


def downgrade() -> None:
    conn = op.get_bind()
    admin_count = conn.execute(sa.text("SELECT count(*) FROM users WHERE role = 'admin'")).scalar() or 0
    if admin_count > 1:
        raise RuntimeError(
            "Cannot downgrade 009: %d admin accounts exist, but revision 004 enforces at most one. "
            "Demote or delete extra admins first." % admin_count
        )

    op.create_index(
        "ix_users_only_one_admin",
        "users",
        ["role"],
        unique=True,
        postgresql_where=sa.text("role = 'admin'"),
    )
    op.drop_column("users", "is_active")
    op.drop_column("users", "memory_scope")
