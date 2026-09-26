"""Add cached_tokens / prompt_hash to token_usage

Revision ID: 008
Revises: 007
Create Date: 2026-09-27

LLM 用量里区分「命中缓存的输入 token」：cached_tokens 记命中量，
prompt_hash 记 prompt 前缀指纹，供服务商不回缓存字段时按时间窗口推断。

历史行 cached_tokens 补 0、prompt_hash 留 NULL（无法追溯，不假装知道）。
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "token_usage",
        sa.Column("cached_tokens", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "token_usage",
        sa.Column("prompt_hash", sa.String(64), nullable=True),
    )
    op.create_index("ix_token_usage_prompt_hash", "token_usage", ["prompt_hash"])


def downgrade() -> None:
    op.drop_index("ix_token_usage_prompt_hash", table_name="token_usage")
    op.drop_column("token_usage", "prompt_hash")
    op.drop_column("token_usage", "cached_tokens")
