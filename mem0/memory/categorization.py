"""LLM-based memory categorization (fork addition, Platform-parity feature).

mem0 Platform tags every memory with ``categories``; the OSS SDK has no notion of
categories at all (``_OSSProject.update()`` rejects ``custom_categories`` outright).
This module implements the feature for self-hosted deployments: every extracted
memory is tagged with the closest matches from a caller-supplied catalog, and the
tags land in the memory payload under ``categories`` (a list of strings).

Contract:
- The catalog is supplied per call (``add(..., custom_categories=...)``); this module
  never invents a default catalog of its own.
- Strict mode: only catalog names are accepted. Unknown names, translations and
  case variants from the LLM are dropped.
- Fail open: any error returns ``{}`` so categorization never blocks a write.
- One LLM call per ``add()`` batch, not one call per memory.
"""

import json
import logging
from typing import Any, Dict, List, Optional, Sequence, Tuple

from mem0.memory.utils import extract_json, remove_code_blocks

logger = logging.getLogger(__name__)

#: Payload key the tags are written to. Kept identical to the Platform field name so
#: the same filters/UI code works against both deployments.
CATEGORY_FIELD = "categories"

_HEADER = (
    "你的任务：为给定的每条记忆，从下面的分类目录中挑选最贴切的分类。\n\n"
    "分类目录："
)

_RULES_HEADER = "判定规则（按顺序判断，命中即停止）："

#: Keys that may not name a category when a dict entry carries exactly one key —
#: they signal a malformed ``{"name": ..., "description": ...}`` entry instead.
_RESERVED_ENTRY_KEYS = {"name", "description", "categories", "category", "id"}

_OUTPUT_SPEC = """输出要求：
- 只能使用上面目录中列出的分类名，禁止创造新分类、禁止翻译、禁止输出同义词或简写。
- 分类名必须与目录中的写法完全一致（保持中文原名，不要加引号或标点）。
- 一条记忆可以属于多个分类；确实不属于任何分类时返回空列表。
- 记忆内容可能是中文或英文，按语义归类，但输出的分类名始终取自目录。
- 只输出 JSON，不要解释、不要代码块之外的内容。

输出格式（index 为输入记忆的编号）：
{"results": [{"index": 0, "categories": ["分类名"]}, {"index": 1, "categories": []}]}"""


def normalize_catalog(catalog: Any) -> List[Tuple[str, str]]:
    """Normalize a category catalog into a de-duplicated ``[(name, description)]`` list.

    Accepted shapes:
    - ``[{"name": "个人信息", "description": "..."}]`` — this repo's canonical shape
    - ``[{"个人信息": "..."}]`` — the Platform's documented per-call shape
    - ``{"个人信息": "..."}`` — a plain mapping
    - ``["个人信息", ...]`` — bare names, no descriptions

    Entries without a usable name are skipped; the first occurrence of a name wins.
    """
    if not catalog:
        return []

    if isinstance(catalog, dict):
        items: Sequence[Any] = list(catalog.items())
    elif isinstance(catalog, (list, tuple)):
        items = catalog
    else:
        raise ValueError("custom_categories must be a list or dict of category definitions")

    normalized: List[Tuple[str, str]] = []
    seen = set()
    for entry in items:
        name: Optional[str] = None
        description = ""
        if isinstance(entry, str):
            name = entry
        elif isinstance(entry, dict):
            if entry.get("name"):
                name = str(entry["name"])
                description = str(entry.get("description") or "")
            elif len(entry) == 1:
                key, value = next(iter(entry.items()))
                # A lone ``{"description": ...}`` is a malformed entry, not a
                # ``{name: description}`` mapping — reserved keys never name a category.
                if str(key).strip().lower() not in _RESERVED_ENTRY_KEYS:
                    name = str(key)
                    description = str(value or "")
        elif isinstance(entry, (list, tuple)) and len(entry) == 2:
            name = str(entry[0])
            description = str(entry[1] or "")

        if name is None:
            continue
        # Strip regular and ideographic spaces — catalogs get copy-pasted from docs.
        name = name.replace("\u3000", " ").strip()
        description = description.replace("\u3000", " ").strip()
        if not name or name in seen:
            continue
        seen.add(name)
        normalized.append((name, description))

    return normalized


def build_categorization_prompt(catalog: Any, decision_rules: Optional[Sequence[str]] = None) -> str:
    """Build the system prompt: catalog + optional decision rules + output spec."""
    entries = normalize_catalog(catalog)
    if not entries:
        raise ValueError("cannot build a categorization prompt from an empty catalog")

    lines = [f"- {name}：{description}" if description else f"- {name}" for name, description in entries]
    parts = [_HEADER, "\n".join(lines)]
    if decision_rules:
        rules = [str(rule).strip() for rule in decision_rules if str(rule).strip()]
        if rules:
            parts.append(_RULES_HEADER)
            parts.append("\n".join(f"{idx}. {rule}" for idx, rule in enumerate(rules, 1)))
    parts.append(_OUTPUT_SPEC)
    return "\n\n".join(parts)


def parse_categorization_response(response: str, catalog: Any) -> Dict[int, List[str]]:
    """Parse the LLM response into ``{memory_index: [category, ...]}``.

    Only names present in the catalog are kept (case-insensitive fallback for ASCII
    variants); malformed responses yield an empty dict rather than raising.
    """
    entries = normalize_catalog(catalog)
    if not entries or not response:
        return {}

    valid_names = {name for name, _ in entries}
    lower_to_original = {name.lower(): name for name in valid_names}

    try:
        payload = remove_code_blocks(response)
        if not payload or not payload.strip():
            return {}
        try:
            parsed = json.loads(payload, strict=False)
        except json.JSONDecodeError:
            parsed = json.loads(extract_json(payload), strict=False)
    except Exception as e:
        logger.warning(f"Failed to parse categorization response: {e}. Response: {str(response)[:200]}")
        return {}

    raw_results = parsed.get("results") if isinstance(parsed, dict) else None
    if raw_results is None and isinstance(parsed, dict):
        # Tolerate {"0": [...], "1": [...]} and {"categories": [...]} shaped responses.
        raw_results = parsed.get("categories") if "categories" in parsed else parsed
    if isinstance(raw_results, dict):
        raw_results = [{"index": key, "categories": value} for key, value in raw_results.items()]
    if not isinstance(raw_results, list):
        logger.warning("Categorization response has no usable results list")
        return {}

    mapped: Dict[int, List[str]] = {}
    for item in raw_results:
        if not isinstance(item, dict):
            continue
        raw_index = item.get("index")
        if raw_index is None:
            continue
        try:
            index = int(str(raw_index).strip())
        except (TypeError, ValueError):
            continue
        raw_categories = item.get("categories")
        if isinstance(raw_categories, str):
            raw_categories = [raw_categories]
        if not isinstance(raw_categories, list):
            continue

        matched: List[str] = []
        for category in raw_categories:
            name = str(category).replace("\u3000", " ").strip()
            if not name:
                continue
            if name in valid_names:
                resolved = name
            elif name.lower() in lower_to_original:
                resolved = lower_to_original[name.lower()]
            else:
                logger.info(f"Ignoring unknown category from LLM: {name}")
                continue
            if resolved not in matched:
                matched.append(resolved)
        if matched:
            mapped[index] = matched

    return mapped


def categorize_memories(
    llm: Any,
    texts: Sequence[str],
    catalog: Any,
    decision_rules: Optional[Sequence[str]] = None,
) -> Dict[int, List[str]]:
    """Tag a batch of memory texts with categories from ``catalog`` in ONE LLM call.

    Args:
        llm: The ``Memory`` instance's own LLM (no extra client configuration needed).
        texts: Memory texts to classify, in index order.
        catalog: Category catalog, see :func:`normalize_catalog`.
        decision_rules: Optional ordered disambiguation rules (the "分类判断规则" block).

    Returns:
        ``{index: [category, ...]}`` — only indices with at least one match appear.
        Returns ``{}`` on any failure so that memory creation is never blocked.
    """
    clean_texts = [text for text in texts if text]
    if not clean_texts:
        return {}

    # Fail-open: a malformed catalog (wrong type, unusable entries) must degrade to
    # "no categories", never raise — callers invoke this from inside add().
    try:
        if not normalize_catalog(catalog):
            return {}
        system_prompt = build_categorization_prompt(catalog, decision_rules)
    except Exception as e:
        logger.warning(f"Categorization skipped (unusable catalog): {e}")
        return {}

    user_payload = {"memories": [{"index": idx, "text": text} for idx, text in enumerate(texts)]}
    try:
        response = llm.generate_response(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
            response_format={"type": "json_object"},
        )
    except Exception as e:
        logger.warning(f"Categorization LLM call failed (memory stored uncategorized): {e}")
        return {}

    try:
        mapped = parse_categorization_response(response, catalog)
    except Exception as e:  # defensive: parse already swallows, keep the write path safe
        logger.warning(f"Unexpected categorization parse error: {e}")
        return {}

    if logger.isEnabledFor(logging.DEBUG):
        logger.debug(f"Categorized {len(mapped)}/{len(texts)} memories")
    return mapped


def categorize_memory(
    llm: Any,
    text: str,
    catalog: Any,
    decision_rules: Optional[Sequence[str]] = None,
) -> List[str]:
    """Single-memory convenience wrapper around :func:`categorize_memories`."""
    return categorize_memories(llm, [text], catalog, decision_rules).get(0, [])
