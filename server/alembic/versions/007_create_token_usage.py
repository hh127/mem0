"""Add token_usage table

Revision ID: 007
Revises: 006
Create Date: 2026-09-26

记忆系统三个模型（LLM / 嵌入 / 重排）的逐次调用 token 用量。
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "token_usage",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("model_type", sa.String(16), nullable=False),
        sa.Column("model_name", sa.String(128), nullable=False, server_default=""),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("operation", sa.String(32), nullable=False, server_default=""),
        sa.Column("user_id", sa.String(128), nullable=True),
        sa.Column("request_id", sa.String(64), nullable=True),
    )
    op.create_index("ix_token_usage_created_at", "token_usage", ["created_at"])
    op.create_index("ix_token_usage_model_type", "token_usage", ["model_type"])
    op.create_index("ix_token_usage_operation", "token_usage", ["operation"])
    op.create_index("ix_token_usage_user_id", "token_usage", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_token_usage_user_id", table_name="token_usage")
    op.drop_index("ix_token_usage_operation", table_name="token_usage")
    op.drop_index("ix_token_usage_model_type", table_name="token_usage")
    op.drop_index("ix_token_usage_created_at", table_name="token_usage")
    op.drop_table("token_usage")
