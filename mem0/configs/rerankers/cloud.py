from typing import Optional

from pydantic import Field

from mem0.configs.rerankers.base import BaseRerankerConfig


class CloudRerankerConfig(BaseRerankerConfig):
    """Configuration for a generic third-party cloud rerank API.

    Speaks the Cohere/Jina/SiliconFlow-compatible rerank protocol::

        POST {base_url}/rerank
        {"model": ..., "query": ..., "documents": [...], "top_n": ...}
        -> {"results": [{"index": 0, "relevance_score": 0.87}, ...]}

    Verified against SiliconFlow (``https://api.siliconflow.cn/v1``) and the
    Jina AI rerank API (``https://api.jina.ai/v1``).

    Attributes:
        base_url: API root, e.g. ``https://api.siliconflow.cn/v1``. If the value
            already ends in ``/rerank`` it is used verbatim as the endpoint.
        api_key: Bearer token. Falls back to the ``RERANKER_API_KEY`` env var.
        model: Rerank model name, e.g. ``BAAI/bge-reranker-v2-m3``. Falls back to
            the ``RERANKER_MODEL`` env var.
        top_k: Number of documents to return after reranking.
        timeout: HTTP timeout in seconds.
        endpoint_path: Override the path appended to ``base_url`` (default ``/rerank``).
    """

    base_url: Optional[str] = Field(
        default=None,
        description="Base URL of the third-party rerank API (e.g. https://api.siliconflow.cn/v1)",
    )
    api_key: Optional[str] = Field(
        default=None,
        description="API key for the rerank service. Falls back to RERANKER_API_KEY.",
    )
    model: Optional[str] = Field(
        default=None,
        description="Rerank model name. Falls back to RERANKER_MODEL.",
    )
    top_k: Optional[int] = Field(
        default=None,
        description="Number of top documents to return after reranking",
    )
    timeout: int = Field(
        default=30,
        description="HTTP request timeout in seconds",
    )
    endpoint_path: Optional[str] = Field(
        default=None,
        description="Path appended to base_url (default: /rerank)",
    )
