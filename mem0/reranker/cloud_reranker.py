import logging
import os
from typing import Any, Dict, List

from mem0.reranker.base import BaseReranker

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

logger = logging.getLogger(__name__)


class CloudReranker(BaseReranker):
    """Reranker backed by any third-party cloud rerank HTTP API.

    Unlike ``LLMReranker`` (which scores documents with a chat completion), this
    class calls a real cross-encoder rerank endpoint, so dedicated reranker models
    such as ``BAAI/bge-reranker-v2-m3`` or ``Qwen/Qwen3-Reranker-8B`` work here.
    ``LLMReranker`` cannot use those, because it sends documents to
    ``/v1/chat/completions`` where cross-encoder models do not exist.

    Supported endpoints (Cohere/Jina/SiliconFlow-compatible shape):

        POST {base_url}/rerank
        {"model": "...", "query": "...", "documents": ["...", "..."], "top_n": 3}
        -> {"results": [{"index": 0, "relevance_score": 0.87}, ...]}
    """

    def __init__(self, config):
        """Initialize the cloud reranker.

        Args:
            config: CloudRerankerConfig (or compatible object) with base_url,
                api_key, model and top_k.
        """
        if not REQUESTS_AVAILABLE:
            raise ImportError("requests package is required for CloudReranker")

        self.config = config

        base_url = (getattr(config, "base_url", None) or os.getenv("RERANKER_BASE_URL") or "").rstrip("/")
        if not base_url:
            raise ValueError(
                "Cloud reranker requires a base_url. Set it in the reranker config "
                "or via the RERANKER_BASE_URL environment variable."
            )

        self.model = getattr(config, "model", None) or os.getenv("RERANKER_MODEL")
        if not self.model:
            raise ValueError(
                "Cloud reranker requires a model name. Set it in the reranker config "
                "or via the RERANKER_MODEL environment variable."
            )

        self.api_key = getattr(config, "api_key", None) or os.getenv("RERANKER_API_KEY")
        self.timeout = getattr(config, "timeout", 30) or 30

        # If the user already pointed base_url straight at the endpoint, respect that.
        if base_url.endswith("/rerank"):
            self.endpoint = base_url
        else:
            path = getattr(config, "endpoint_path", None) or "/rerank"
            if not path.startswith("/"):
                path = "/" + path
            self.endpoint = f"{base_url}{path}"

        logger.debug("CloudReranker endpoint=%s model=%s", self.endpoint, self.model)

    def _doc_text(self, doc: Dict[str, Any]) -> str:
        """Extract the text to be scored from a memory record."""
        for key in ("memory", "text", "content"):
            if key in doc and doc[key] is not None:
                return str(doc[key])
        return str(doc)

    def rerank(self, query: str, documents: List[Dict[str, Any]], top_k: int = None) -> List[Dict[str, Any]]:
        """Rerank documents against the query using the remote rerank API.

        Args:
            query: The search query.
            documents: Memory records to rerank.
            top_k: Number of documents to return (falls back to config.top_k, then all).

        Returns:
            Reranked records, each with an added ``rerank_score`` field.
        """
        if not documents:
            return documents

        n = top_k or getattr(self.config, "top_k", None) or len(documents)
        doc_texts = [self._doc_text(doc) for doc in documents]

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        payload = {
            "model": self.model,
            "query": query,
            "documents": doc_texts,
            "top_n": n,
        }

        try:
            response = requests.post(
                self.endpoint,
                headers=headers,
                json=payload,
                timeout=self.timeout,
            )
            response.raise_for_status()
            data = response.json()

            results = data.get("results") or []
            reranked_docs = []
            for result in results:
                index = result.get("index")
                if index is None or not (0 <= index < len(documents)):
                    continue
                doc = documents[index].copy()
                score = result.get("relevance_score")
                if score is None:
                    score = result.get("score")
                doc["rerank_score"] = score
                reranked_docs.append(doc)

            if not reranked_docs:
                logger.warning("Cloud reranker returned no usable results; keeping original order")
                for doc in documents:
                    doc["rerank_score"] = 0.0
                return documents[:n]

            return reranked_docs

        except Exception as e:
            # Match the built-in providers' behaviour: degrade gracefully, never break search.
            logger.warning("Cloud reranking failed (%s), using original results", e)
            for doc in documents:
                doc["rerank_score"] = 0.0
            return documents[:n]
