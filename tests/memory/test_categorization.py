"""Tests for the fork's Platform-parity Custom Categories feature.

Three layers are covered:

1. ``mem0/memory/categorization.py`` — catalog normalization, prompt building,
   strict response parsing, and the fail-open contract.
2. ``Memory._add_to_vector_store`` — the tags actually reach the payload handed
   to the vector store, on both the inferred (v3) and the raw (``infer=False``)
   paths, and a broken categorizer never blocks a write.
3. ``Memory.add`` resolution order — a per-call ``custom_categories`` beats the
   project-level catalog, and ``categories`` is promoted to a top-level field on
   read paths instead of falling into ``metadata``.
"""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

import mem0.memory.main as main_mod
from mem0.configs.base import MemoryConfig
from mem0.memory.categorization import (
    CATEGORY_FIELD,
    build_categorization_prompt,
    categorize_memories,
    categorize_memory,
    explain_categorization,
    normalize_catalog,
    parse_categorization_response,
)

# A two-entry catalog plus a decision rule, mirroring server/categories.json's shape.
CATALOG = [
    {"name": "个人信息", "description": "用户的稳定背景信息。"},
    {"name": "工作项目", "description": "用户正在进行的工作与项目。"},
    {"name": "个人偏好", "description": "用户喜欢或倾向的事物。"},
    {"name": "ImportantDecision", "description": "An explicit decision."},
]
RULES = ["如果描述的是用户的背景身份 → 个人信息", "如果是正在做的项目 → 工作项目"]


# --------------------------------------------------------------------------- #
# 1. catalog normalization
# --------------------------------------------------------------------------- #


def test_normalize_catalog_reads_name_description_entries():
    assert normalize_catalog([{"name": "个人信息", "description": "背景"}]) == [("个人信息", "背景")]


def test_normalize_catalog_reads_single_key_mapping_entries():
    """Platform's documented per-call shape: [{"个人信息": "描述"}]."""
    assert normalize_catalog([{"个人信息": "背景"}]) == [("个人信息", "背景")]


def test_normalize_catalog_reads_plain_mapping():
    assert normalize_catalog({"个人信息": "背景", "工作项目": ""}) == [("个人信息", "背景"), ("工作项目", "")]


def test_normalize_catalog_reads_bare_names():
    assert normalize_catalog(["个人信息", "工作项目"]) == [("个人信息", ""), ("工作项目", "")]


def test_normalize_catalog_deduplicates_first_occurrence_wins():
    entries = normalize_catalog(
        [{"name": "个人信息", "description": "first"}, {"name": "个人信息", "description": "second"}]
    )
    assert entries == [("个人信息", "first")]


def test_normalize_catalog_strips_ideographic_and_regular_spaces():
    entries = normalize_catalog([{"name": "\u3000个人信息 \u3000", "description": " 背景\u3000"}])
    assert entries == [("个人信息", "背景")]


def test_normalize_catalog_skips_unnamed_entries_but_keeps_the_rest():
    entries = normalize_catalog([{"description": "no name"}, "工作项目", 42, None])
    assert entries == [("工作项目", "")]


def test_normalize_catalog_empty_input_returns_empty_list():
    assert normalize_catalog(None) == []
    assert normalize_catalog([]) == []
    assert normalize_catalog({}) == []


def test_normalize_catalog_rejects_non_catalog_types():
    with pytest.raises(ValueError):
        normalize_catalog(42)


# --------------------------------------------------------------------------- #
# 2. prompt building
# --------------------------------------------------------------------------- #


def test_prompt_contains_every_name_and_description():
    prompt = build_categorization_prompt(CATALOG, RULES)
    for name, description in normalize_catalog(CATALOG):
        assert name in prompt
        assert description in prompt


def test_prompt_numbers_the_decision_rules_in_order():
    prompt = build_categorization_prompt(CATALOG, RULES)
    assert "1. " + RULES[0] in prompt
    assert "2. " + RULES[1] in prompt
    assert prompt.index(RULES[0]) < prompt.index(RULES[1])


def test_prompt_omits_the_rules_block_when_no_rules_given():
    assert "判定规则" not in build_categorization_prompt(CATALOG)
    assert "判定规则" not in build_categorization_prompt(CATALOG, [])
    assert "判定规则" not in build_categorization_prompt(CATALOG, ["   "])


def test_prompt_states_the_strict_output_contract():
    prompt = build_categorization_prompt(CATALOG)
    assert "禁止创造新分类" in prompt
    assert '"results"' in prompt


def test_prompt_requires_a_non_empty_catalog():
    with pytest.raises(ValueError):
        build_categorization_prompt([])


# --------------------------------------------------------------------------- #
# 3. response parsing (strict mode)
# --------------------------------------------------------------------------- #


def test_parse_keeps_catalog_names():
    response = json.dumps({"results": [{"index": 0, "categories": ["个人信息"]}]}, ensure_ascii=False)
    assert parse_categorization_response(response, CATALOG) == {0: ["个人信息"]}


def test_parse_handles_code_block_wrapped_json():
    response = '```json\n{"results": [{"index": 1, "categories": ["工作项目"]}]}\n```'
    assert parse_categorization_response(response, CATALOG) == {1: ["工作项目"]}


def test_parse_accepts_string_indices():
    response = json.dumps({"results": [{"index": "2", "categories": ["个人信息"]}]}, ensure_ascii=False)
    assert parse_categorization_response(response, CATALOG) == {2: ["个人信息"]}


def test_parse_accepts_a_bare_categories_string():
    response = json.dumps({"results": [{"index": 0, "categories": "个人信息"}]}, ensure_ascii=False)
    assert parse_categorization_response(response, CATALOG) == {0: ["个人信息"]}


def test_parse_accepts_index_keyed_mapping_without_results_wrapper():
    response = json.dumps({"0": ["个人信息"]}, ensure_ascii=False)
    assert parse_categorization_response(response, CATALOG) == {0: ["个人信息"]}


def test_parse_drops_unknown_categories():
    response = json.dumps({"results": [{"index": 0, "categories": ["工作项目", "自创分类"]}]}, ensure_ascii=False)
    assert parse_categorization_response(response, CATALOG) == {0: ["工作项目"]}


def test_parse_drops_entries_whose_categories_all_unknown():
    response = json.dumps({"results": [{"index": 0, "categories": ["自创分类"]}]}, ensure_ascii=False)
    assert parse_categorization_response(response, CATALOG) == {}


def test_parse_resolves_ascii_case_variants_to_the_catalog_name():
    response = json.dumps({"results": [{"index": 0, "categories": ["importantdecision"]}]}, ensure_ascii=False)
    assert parse_categorization_response(response, CATALOG) == {0: ["ImportantDecision"]}


def test_parse_deduplicates_repeated_categories():
    response = json.dumps({"results": [{"index": 0, "categories": ["个人信息", "个人信息"]}]}, ensure_ascii=False)
    assert parse_categorization_response(response, CATALOG) == {0: ["个人信息"]}


def test_parse_ignores_unusable_entries_without_failing_the_batch():
    response = json.dumps(
        {
            "results": [
                {"index": 0, "categories": ["个人信息"]},
                {"categories": ["工作项目"]},  # no index
                {"index": "abc", "categories": ["工作项目"]},  # unparsable index
                "not-a-dict",
                {"index": 3},  # no categories
            ]
        },
        ensure_ascii=False,
    )
    assert parse_categorization_response(response, CATALOG) == {0: ["个人信息"]}


@pytest.mark.parametrize(
    "response",
    [
        "",
        None,
        "not json at all",
        '{"results": "nope"}',
        '{"results": [1, 2, 3]}',
        '{"unexpected": true}',
    ],
)
def test_parse_returns_empty_dict_for_garbage(response):
    assert parse_categorization_response(response, CATALOG) == {}


def test_parse_returns_empty_dict_for_empty_catalog():
    response = json.dumps({"results": [{"index": 0, "categories": ["个人信息"]}]}, ensure_ascii=False)
    assert parse_categorization_response(response, []) == {}


# --------------------------------------------------------------------------- #
# 4. categorize_memories / categorize_memory
# --------------------------------------------------------------------------- #


class ScriptedLLM:
    """LLM stub returning canned responses and recording every call."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def generate_response(self, messages, **kwargs):
        self.calls.append({"messages": messages, "kwargs": kwargs})
        response = self.responses[min(len(self.calls) - 1, len(self.responses) - 1)]
        if isinstance(response, Exception):
            raise response
        if callable(response):
            return response(messages)
        return response


def test_categorize_memories_uses_one_llm_call_for_the_whole_batch():
    llm = ScriptedLLM([json.dumps({"results": [{"index": 0, "categories": ["个人信息"]}]}, ensure_ascii=False)])
    mapped = categorize_memories(llm, ["文本一", "文本二", "文本三"], CATALOG, RULES)
    assert len(llm.calls) == 1
    assert mapped == {0: ["个人信息"]}


def test_categorize_memories_sends_the_catalog_and_every_text():
    llm = ScriptedLLM([json.dumps({"results": []})])
    categorize_memories(llm, ["文本一"], CATALOG, RULES)
    system_prompt = llm.calls[0]["messages"][0]["content"]
    user_payload = llm.calls[0]["messages"][1]["content"]
    assert "个人信息" in system_prompt
    assert RULES[0] in system_prompt
    assert json.loads(user_payload) == {"memories": [{"index": 0, "text": "文本一"}]}
    assert llm.calls[0]["kwargs"].get("response_format") == {"type": "json_object"}


def test_categorize_memories_maps_several_indices():
    llm = ScriptedLLM(
        [
            json.dumps(
                {
                    "results": [
                        {"index": 0, "categories": ["个人信息"]},
                        {"index": 2, "categories": ["工作项目"]},
                    ]
                },
                ensure_ascii=False,
            )
        ]
    )
    assert categorize_memories(llm, ["a", "b", "c"], CATALOG) == {0: ["个人信息"], 2: ["工作项目"]}


def test_categorize_memories_returns_empty_dict_when_llm_raises():
    llm = ScriptedLLM([RuntimeError("provider down")])
    assert categorize_memories(llm, ["文本"], CATALOG) == {}


def test_categorize_memories_returns_empty_dict_when_llm_returns_garbage():
    llm = ScriptedLLM(["I could not decide, sorry."])
    assert categorize_memories(llm, ["文本"], CATALOG) == {}


def test_categorize_memories_skips_the_llm_without_a_catalog():
    llm = ScriptedLLM([json.dumps({"results": []})])
    assert categorize_memories(llm, ["文本"], []) == {}
    assert categorize_memories(llm, ["文本"], None) == {}
    assert llm.calls == []


def test_categorize_memories_skips_the_llm_for_empty_texts():
    llm = ScriptedLLM([json.dumps({"results": []})])
    assert categorize_memories(llm, [], CATALOG) == {}
    assert categorize_memories(llm, ["", None], CATALOG) == {}
    assert llm.calls == []


def test_categorize_memories_is_fail_open_on_a_malformed_catalog():
    """A bad catalog must degrade to 'no categories', never raise into add()."""
    llm = ScriptedLLM([json.dumps({"results": []})])
    assert categorize_memories(llm, ["文本"], 42) == {}
    assert categorize_memories(llm, ["文本"], [{"description": "no name"}]) == {}
    assert llm.calls == []


def test_categorize_memory_wraps_a_single_text():
    llm = ScriptedLLM([json.dumps({"results": [{"index": 0, "categories": ["工作项目"]}]}, ensure_ascii=False)])
    assert categorize_memory(llm, "文本", CATALOG) == ["工作项目"]


def test_categorize_memory_returns_empty_list_when_unmatched():
    llm = ScriptedLLM([json.dumps({"results": []})])
    assert categorize_memory(llm, "文本", CATALOG) == []


# --------------------------------------------------------------------------- #
# 5. add() wiring
# --------------------------------------------------------------------------- #

EXTRACTION_RESPONSE = json.dumps(
    {"memory": [{"text": "用户正在做造价审计项目。"}, {"text": "用户喜欢喝茶。"}]},
    ensure_ascii=False,
)


class DispatchingLLM:
    """Answers extraction and categorization calls by looking at the system prompt."""

    def __init__(self, categorization_response):
        self.categorization_response = categorization_response
        self.extraction_calls = 0
        self.categorization_calls = 0

    def generate_response(self, messages, **kwargs):
        system_prompt = messages[0]["content"]
        if "分类目录" in system_prompt:
            self.categorization_calls += 1
            response = self.categorization_response
            if isinstance(response, Exception):
                raise response
            if callable(response):
                return response(messages)
            return response
        self.extraction_calls += 1
        return EXTRACTION_RESPONSE


class RecordingVectorStore:
    def __init__(self, existing=None):
        self.existing = existing or []
        self.inserts = []

    def search(self, **kwargs):
        return list(self.existing)

    def insert(self, vectors=None, ids=None, payloads=None, **kwargs):
        self.inserts.append({"vectors": vectors, "ids": ids, "payloads": payloads})
        return None

    def get(self, vector_id):
        return None

    def update(self, **kwargs):
        return None


class RecordingDB:
    def __init__(self):
        self.saved_messages = []
        self.history = []

    def get_last_messages(self, session_scope, limit=10):
        return []

    def save_messages(self, messages, session_scope=None):
        self.saved_messages.append(messages)

    def batch_add_history(self, records):
        self.history.extend(records)

    def add_history(self, *args, **kwargs):
        return None


@pytest.fixture
def quiet(monkeypatch):
    """Silence telemetry and entity extraction so the add pipeline is deterministic."""

    def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr(main_mod, "capture_event", _noop, raising=False)
    monkeypatch.setattr(main_mod, "extract_entities_batch", lambda texts: [[] for _ in texts], raising=False)
    monkeypatch.setattr(main_mod, "lemmatize_for_bm25", lambda text: text, raising=False)


def _bare_memory(llm):
    """A Memory instance carrying only what _add_to_vector_store touches."""
    mem = main_mod.Memory.__new__(main_mod.Memory)
    mem.llm = llm
    mem.api_version = "v1.1"
    mem.custom_instructions = None
    mem.db = RecordingDB()
    mem.vector_store = RecordingVectorStore()
    mem.embedding_model = MagicMock()
    mem.embedding_model.embed.return_value = [0.1, 0.2, 0.3]
    mem.embedding_model.embed_batch.side_effect = lambda texts, kind: [[0.1, 0.2, 0.3] for _ in texts]
    # Entity linking is stubbed out (see `quiet`), so no entity store is ever touched.
    mem._entity_store = None
    return mem


def _saved_payloads(mem):
    return [payload for call in mem.vector_store.inserts for payload in (call["payloads"] or [])]


def _categorization_response(*pairs):
    return json.dumps(
        {"results": [{"index": idx, "categories": cats} for idx, cats in pairs]},
        ensure_ascii=False,
    )


def test_inferred_add_writes_categories_into_the_payload(quiet):
    llm = DispatchingLLM(_categorization_response((0, ["工作项目"]), (1, ["个人偏好"])))
    mem = _bare_memory(llm)
    messages = [{"role": "user", "content": "我在做造价审计项目，平时喜欢喝茶。"}]

    mem._add_to_vector_store(
        messages, {"user_id": "u1"}, {"user_id": "u1"}, True, custom_categories=CATALOG
    )

    payloads = _saved_payloads(mem)
    assert len(payloads) == 2
    assert payloads[0][CATEGORY_FIELD] == ["工作项目"]
    assert payloads[1][CATEGORY_FIELD] == ["个人偏好"]
    # One classification call for the whole batch, on top of the single extraction call.
    assert llm.extraction_calls == 1
    assert llm.categorization_calls == 1


def test_inferred_add_leaves_payload_untouched_without_a_catalog(quiet):
    llm = DispatchingLLM(_categorization_response((0, ["工作项目"]), (1, ["个人偏好"])))
    mem = _bare_memory(llm)

    mem._add_to_vector_store([{"role": "user", "content": "文本"}], {"user_id": "u1"}, {"user_id": "u1"}, True)

    assert llm.categorization_calls == 0
    for payload in _saved_payloads(mem):
        assert CATEGORY_FIELD not in payload


def test_categorization_failure_still_persists_the_memories(quiet):
    llm = DispatchingLLM(RuntimeError("categorizer exploded"))
    mem = _bare_memory(llm)

    mem._add_to_vector_store(
        [{"role": "user", "content": "文本"}], {"user_id": "u1"}, {"user_id": "u1"}, True, custom_categories=CATALOG
    )

    payloads = _saved_payloads(mem)
    assert len(payloads) == 2  # memories stored uncategorized, not dropped
    for payload in payloads:
        assert CATEGORY_FIELD not in payload


def test_inferred_add_categorizes_deduplicated_records_only(quiet):
    """A duplicate text must not cost a second record — or a second category slot."""
    llm = DispatchingLLM(_categorization_response((0, ["工作项目"])))
    mem = _bare_memory(llm)
    duplicate = json.dumps({"memory": [{"text": "同一条。"}, {"text": "同一条。"}]}, ensure_ascii=False)
    llm.generate_response = lambda messages, **kwargs: (
        _categorization_response((0, ["工作项目"]))
        if "分类目录" in messages[0]["content"]
        else duplicate
    )

    mem._add_to_vector_store(
        [{"role": "user", "content": "文本"}], {"user_id": "u1"}, {"user_id": "u1"}, True, custom_categories=CATALOG
    )

    payloads = _saved_payloads(mem)
    assert len(payloads) == 1
    assert payloads[0][CATEGORY_FIELD] == ["工作项目"]


def test_raw_add_writes_categories_into_the_payload(quiet):
    llm = DispatchingLLM(_categorization_response((0, ["工作项目"]), (1, ["个人信息"])))
    mem = _bare_memory(llm)
    captured = []
    mem._create_memory = lambda text, embeddings, metadata: captured.append((text, metadata)) or "mem-id"
    messages = [
        {"role": "system", "content": "system prompt is not categorized"},
        {"role": "user", "content": "第一条。"},
        {"role": "user", "content": "第二条。"},
    ]

    mem._add_to_vector_store(
        messages, {"user_id": "u1"}, {"user_id": "u1"}, False, custom_categories=CATALOG
    )

    assert len(captured) == 2
    assert captured[0][1][CATEGORY_FIELD] == ["工作项目"]
    assert captured[1][1][CATEGORY_FIELD] == ["个人信息"]


def test_raw_add_without_a_catalog_skips_the_categorizer(quiet):
    llm = DispatchingLLM(_categorization_response((0, ["工作项目"])))
    mem = _bare_memory(llm)
    captured = []
    mem._create_memory = lambda text, embeddings, metadata: captured.append((text, metadata)) or "mem-id"

    mem._add_to_vector_store([{"role": "user", "content": "文本"}], {"user_id": "u1"}, {"user_id": "u1"}, False)

    assert llm.categorization_calls == 0
    assert CATEGORY_FIELD not in captured[0][1]


# --------------------------------------------------------------------------- #
# 6. add() resolution order + read-path promotion
# --------------------------------------------------------------------------- #


def _real_memory(config=None, llm=None):
    """A fully constructed Memory whose collaborators are all mocks."""
    embedder = MagicMock()
    embedder.embed.return_value = [0.1, 0.2, 0.3]
    embedder.embed_batch.side_effect = lambda texts, kind: [[0.1, 0.2, 0.3] for _ in texts]
    store = RecordingVectorStore()

    with (
        patch("mem0.utils.factory.EmbedderFactory.create", return_value=embedder),
        patch("mem0.utils.factory.VectorStoreFactory.create", return_value=store),
        patch("mem0.utils.factory.LlmFactory.create", return_value=llm),
        patch("mem0.memory.storage.SQLiteManager", return_value=RecordingDB()),
    ):
        return main_mod.Memory(config or MemoryConfig())


def test_memory_config_carries_the_project_catalog():
    config = MemoryConfig(custom_categories=CATALOG, custom_category_rules=RULES)
    assert config.custom_categories == CATALOG
    assert config.custom_category_rules == RULES
    assert MemoryConfig().custom_categories is None


def test_project_catalog_from_config_is_used_by_add(quiet):
    llm = DispatchingLLM(_categorization_response((0, ["工作项目"]), (1, ["个人偏好"])))
    mem = _real_memory(MemoryConfig(custom_categories=CATALOG, custom_category_rules=RULES), llm=llm)

    mem.add([{"role": "user", "content": "文本"}], user_id="u1")

    assert llm.categorization_calls == 1
    payloads = _saved_payloads(mem)
    assert payloads[0][CATEGORY_FIELD] == ["工作项目"]


def test_per_call_catalog_replaces_the_project_catalog(quiet):
    llm = DispatchingLLM(_categorization_response((0, ["临时分类"])))
    mem = _real_memory(MemoryConfig(custom_categories=CATALOG), llm=llm)
    per_call = [{"name": "临时分类", "description": "只对本次调用生效。"}]

    mem.add([{"role": "user", "content": "文本"}], user_id="u1", custom_categories=per_call)

    assert llm.categorization_calls == 1
    # The project catalog must not leak into the per-call prompt.
    assert "个人信息" not in json.dumps(per_call)
    payloads = _saved_payloads(mem)
    assert payloads[0][CATEGORY_FIELD] == ["临时分类"]


def test_per_call_rules_replace_the_project_rules(quiet):
    captured = {}

    def fake_categorize(llm, texts, catalog, rules=None):
        captured["rules"] = rules
        return {0: ["工作项目"]}

    with patch.object(main_mod, "categorize_memories", fake_categorize):
        llm = DispatchingLLM(_categorization_response((0, ["工作项目"])))
        mem = _real_memory(MemoryConfig(custom_categories=CATALOG, custom_category_rules=RULES), llm=llm)
        mem.add([{"role": "user", "content": "文本"}], user_id="u1", custom_category_rules=["临时规则"])

    assert captured["rules"] == ["临时规则"]


def test_add_without_any_catalog_never_calls_the_categorizer(quiet):
    llm = DispatchingLLM(_categorization_response((0, ["工作项目"])))
    mem = _real_memory(llm=llm)

    mem.add([{"role": "user", "content": "文本"}], user_id="u1")

    assert llm.categorization_calls == 0


def test_search_surfaces_categories_as_a_top_level_field(quiet):
    """categories must be promoted, not buried in metadata (Platform parity)."""
    mem = main_mod.Memory.__new__(main_mod.Memory)
    mem.embedding_model = MagicMock()
    mem.embedding_model.embed.return_value = [0.1, 0.2, 0.3]
    mem.vector_store = MagicMock()
    mem.vector_store.search.return_value = [
        SimpleNamespace(
            id="m1",
            score=0.9,
            payload={
                "data": "用户在做造价审计项目。",
                "hash": "h1",
                "user_id": "u1",
                "categories": ["工作项目"],
                "some_extra": "kept in metadata",
            },
        )
    ]
    mem.vector_store.keyword_search.return_value = None

    results = mem._search_vector_store("造价", {"user_id": "u1"}, 5)

    assert results[0]["categories"] == ["工作项目"]
    assert results[0]["memory"] == "用户在做造价审计项目。"
    assert (results[0].get("metadata") or {}).get("some_extra") == "kept in metadata"
    assert "categories" not in (results[0].get("metadata") or {})


# --------------------------------------------------------------------------- #
# 7. AsyncMemory parity
# --------------------------------------------------------------------------- #


def _bare_async_memory(llm):
    """An AsyncMemory instance carrying only what _add_to_vector_store touches."""
    mem = main_mod.AsyncMemory.__new__(main_mod.AsyncMemory)
    mem.llm = llm
    mem.api_version = "v1.1"
    mem.custom_instructions = None
    mem.db = RecordingDB()
    mem.vector_store = RecordingVectorStore()
    mem.embedding_model = MagicMock()
    mem.embedding_model.embed.return_value = [0.1, 0.2, 0.3]
    mem.embedding_model.embed_batch.side_effect = lambda texts, kind: [[0.1, 0.2, 0.3] for _ in texts]
    mem._entity_store = None
    return mem


@pytest.mark.asyncio
async def test_async_inferred_add_writes_categories_into_the_payload(quiet):
    llm = DispatchingLLM(_categorization_response((0, ["工作项目"]), (1, ["个人偏好"])))
    mem = _bare_async_memory(llm)

    await mem._add_to_vector_store(
        [{"role": "user", "content": "文本"}], {"user_id": "u1"}, {"user_id": "u1"}, True, custom_categories=CATALOG
    )

    payloads = _saved_payloads(mem)
    assert len(payloads) == 2
    assert payloads[0][CATEGORY_FIELD] == ["工作项目"]
    assert payloads[1][CATEGORY_FIELD] == ["个人偏好"]
    assert llm.extraction_calls == 1
    assert llm.categorization_calls == 1


@pytest.mark.asyncio
async def test_async_add_is_fail_open_when_categorization_breaks(quiet):
    llm = DispatchingLLM(RuntimeError("categorizer exploded"))
    mem = _bare_async_memory(llm)

    await mem._add_to_vector_store(
        [{"role": "user", "content": "文本"}], {"user_id": "u1"}, {"user_id": "u1"}, True, custom_categories=CATALOG
    )

    payloads = _saved_payloads(mem)
    assert len(payloads) == 2
    for payload in payloads:
        assert CATEGORY_FIELD not in payload


@pytest.mark.asyncio
async def test_async_add_without_a_catalog_never_categorizes(quiet):
    llm = DispatchingLLM(_categorization_response((0, ["工作项目"])))
    mem = _bare_async_memory(llm)

    await mem._add_to_vector_store([{"role": "user", "content": "文本"}], {"user_id": "u1"}, {"user_id": "u1"}, True)

    assert llm.categorization_calls == 0
    for payload in _saved_payloads(mem):
        assert CATEGORY_FIELD not in payload


def test_async_search_surfaces_categories_as_a_top_level_field():
    """The async read path promotes categories too."""
    import asyncio

    mem = main_mod.AsyncMemory.__new__(main_mod.AsyncMemory)
    mem.embedding_model = MagicMock()
    mem.embedding_model.embed.return_value = [0.1, 0.2, 0.3]
    mem.vector_store = MagicMock()
    mem.vector_store.search.return_value = [
        SimpleNamespace(id="m1", score=0.9, payload={"data": "文本", "categories": ["工作项目"]})
    ]
    mem.vector_store.keyword_search.return_value = None

    with (
        patch.object(main_mod, "extract_entities", lambda query: []),
        patch.object(main_mod, "lemmatize_for_bm25", lambda text: text),
    ):
        results = asyncio.run(mem._search_vector_store("造价", {"user_id": "u1"}, 5))

    assert results[0]["categories"] == ["工作项目"]


# --------------------------------------------------------------------------- #
# 8. explain_categorization (the dashboard's category tester)
# --------------------------------------------------------------------------- #


def _candidates_response(*pairs):
    """Build a ranked-candidates response: ``_candidates_response(("工作项目", 0.9, "why"), ...)``."""
    return json.dumps(
        {"candidates": [{"name": name, "confidence": score, "reason": reason} for name, score, reason in pairs]},
        ensure_ascii=False,
    )


def test_explain_ranks_candidates_and_reports_the_top_one():
    llm = ScriptedLLM([_candidates_response(("工作项目", 0.62, "在做的项目"), ("个人信息", 0.31, "工作背景"))])
    result = explain_categorization(llm, "我在做造价审计项目", CATALOG, RULES)
    assert result["error"] is None
    assert result["top"] == "工作项目"
    assert [c["name"] for c in result["candidates"]] == ["工作项目", "个人信息"]
    assert result["candidates"][0]["reason"] == "在做的项目"


def test_explain_sorts_by_confidence_not_by_response_order():
    llm = ScriptedLLM([_candidates_response(("个人偏好", 0.2, "弱"), ("工作项目", 0.8, "强"))])
    result = explain_categorization(llm, "文本", CATALOG)
    assert [c["name"] for c in result["candidates"]] == ["工作项目", "个人偏好"]
    assert result["top"] == "工作项目"


def test_explain_flags_a_boundary_conflict_when_the_top_two_are_close():
    llm = ScriptedLLM([_candidates_response(("个人偏好", 0.76, "偏好"), ("工作项目", 0.71, "决定"))])
    result = explain_categorization(llm, "文本", CATALOG)
    assert result["conflict"] is True


def test_explain_does_not_flag_a_conflict_when_the_winner_is_clear():
    llm = ScriptedLLM([_candidates_response(("个人偏好", 0.91, "偏好"), ("工作项目", 0.3, "决定"))])
    result = explain_categorization(llm, "文本", CATALOG)
    assert result["conflict"] is False


def test_explain_drops_unknown_names_and_unusable_confidences():
    """The tester must never show a category the catalog does not contain, nor a made-up score."""
    response = json.dumps(
        {
            "candidates": [
                {"name": "临时分类", "confidence": 0.99, "reason": "not in catalog"},
                {"name": "工作项目", "confidence": "0.5", "reason": "string score is tolerated"},
                {"name": "个人信息", "confidence": "high", "reason": "no numeric score"},
            ]
        },
        ensure_ascii=False,
    )
    result = explain_categorization(ScriptedLLM([response]), "文本", CATALOG)
    assert [c["name"] for c in result["candidates"]] == ["工作项目"]
    assert result["candidates"][0]["confidence"] == 0.5


def test_explain_clamps_confidence_into_the_unit_interval():
    llm = ScriptedLLM([_candidates_response(("工作项目", 4.2, "over"), ("个人信息", -1, "under"))])
    result = explain_categorization(llm, "文本", CATALOG)
    assert [c["confidence"] for c in result["candidates"]] == [1.0, 0.0]


def test_explain_tolerates_case_variants_of_ascii_names():
    llm = ScriptedLLM([_candidates_response(("importantdecision", 0.8, "ascii"))])
    result = explain_categorization(llm, "文本", CATALOG)
    assert result["top"] == "ImportantDecision"


def test_explain_handles_code_fenced_responses():
    llm = ScriptedLLM(["```json\n" + _candidates_response(("工作项目", 0.9, "fenced")) + "\n```"])
    assert explain_categorization(llm, "文本", CATALOG)["top"] == "工作项目"


def test_explain_returns_no_candidates_on_garbage():
    result = explain_categorization(ScriptedLLM(["完全不是 JSON"]), "文本", CATALOG)
    assert result["candidates"] == []
    assert result["top"] is None
    assert result["conflict"] is False


def test_explain_reports_llm_failure_instead_of_raising():
    result = explain_categorization(ScriptedLLM([RuntimeError("provider down")]), "文本", CATALOG)
    assert result["candidates"] == []
    assert "分类模型调用失败" in result["error"]


def test_explain_skips_the_llm_for_empty_text_or_empty_catalog():
    llm = ScriptedLLM([_candidates_response(("工作项目", 0.9, "x"))])
    assert explain_categorization(llm, "   ", CATALOG)["error"]
    assert explain_categorization(llm, "文本", [])["error"]
    assert llm.calls == []


def test_explain_prompt_carries_the_catalog_and_the_rules():
    llm = ScriptedLLM([_candidates_response(("工作项目", 0.9, "x"))])
    explain_categorization(llm, "我在做造价审计项目", CATALOG, RULES)
    call = llm.calls[0]
    system_prompt = call["messages"][0]["content"]
    assert "个人信息" in system_prompt
    assert RULES[0] in system_prompt
    assert call["messages"][1]["content"] == "我在做造价审计项目"
    assert call["kwargs"].get("response_format") == {"type": "json_object"}


def test_explain_caps_the_number_of_candidates():
    llm = ScriptedLLM(
        [
            _candidates_response(
                ("工作项目", 0.9, "a"),
                ("个人信息", 0.8, "b"),
                ("个人偏好", 0.7, "c"),
                ("ImportantDecision", 0.6, "d"),
            )
        ]
    )
    assert len(explain_categorization(llm, "文本", CATALOG)["candidates"]) == 3
