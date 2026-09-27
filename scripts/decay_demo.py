"""Live functional test of search-time decay on a real Memory instance.

Runs the FULL search() path — semantic search, hybrid scoring, decay, write-back
— against a real pgvector store. A scripted embedder pins semantic similarity to
exact values, so decay is the only variable that moves.

Scenario:
  * "stale" memory: highest semantic similarity (1.00) but written a year ago
  * "fresh" memory: lower similarity (0.60) but written today
  * then: keep retrieving both, and watch the frequently-used one climb back
"""

import hashlib
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

os.environ["MEM0_TELEMETRY"] = "false"
os.environ["MEM0_DECAY"] = "true"

import mem0.memory.main as main_mod  # noqa: E402
from mem0.memory.main import Memory  # noqa: E402
from mem0.vector_stores.pgvector import PGVector  # noqa: E402

# Silence telemetry / first-run banners so the output is just the results.
for _name in (
    "capture_event",
    "detect_temporal_usage_from_search",
    "detect_scale_threshold_from_top_k",
    "display_first_run_notice",
    "display_scale_threshold_notice",
    "display_performance_slow_query_notice",
    "display_temporal_usage_notice",
):
    if hasattr(main_mod, _name):
        setattr(main_mod, _name, lambda *a, **k: None)

DIMS = 8
QUERY = "server configuration"
VEC_QUERY = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
VEC_HIGH = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]   # cosine 1.00 with the query
VEC_LOW = [0.6, 0.8, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]    # cosine 0.60 with the query


class ScriptedEmbedder:
    """Returns preset vectors so semantic similarity is exactly controlled."""

    def __init__(self, table, fallback):
        self.table = table
        self.fallback = fallback

    def embed(self, text, memory_action=None):
        return list(self.table.get(text, self.fallback))

    def embed_batch(self, texts, memory_action=None):
        return [list(self.table.get(t, self.fallback)) for t in texts]


def now_iso(days_ago=0):
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


vs = PGVector(
    dbname=os.environ.get("PGVECTOR_DB", "mem0"),
    collection_name="decay_demo",
    embedding_model_dims=DIMS,
    user=os.environ.get("PGVECTOR_USER", "mem0"),
    password=os.environ.get("PGVECTOR_PASSWORD", "mem0"),
    host=os.environ.get("PGVECTOR_HOST", "127.0.0.1"),
    port=int(os.environ.get("PGVECTOR_PORT", "15433")),
    diskann=False,
    hnsw=False,
)
vs.delete_col()

mem = Memory.__new__(Memory)
mem.api_version = "v1.1"
mem.reranker = None
mem.vector_store = vs
mem.embedding_model = ScriptedEmbedder(
    {QUERY: VEC_QUERY}, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]
)


def insert(vector, text, days_ago):
    mid = str(uuid.uuid4())
    ts = now_iso(days_ago)
    vs.insert(
        [vector],
        [{
            "data": text,
            "hash": hashlib.md5(text.encode()).hexdigest(),
            "text_lemmatized": "",  # keyword channel off, to isolate the vector signal
            "created_at": ts,
            "updated_at": ts,
            "user_id": "u1",
        }],
        [mid],
    )
    return mid


insert(VEC_HIGH, "server configuration: the rack in Berlin (written a year ago)", 365)
insert(VEC_LOW, "server configuration: the rack in Lisbon (written today)", 0)


def set_decay(enabled):
    os.environ["MEM0_DECAY"] = "true" if enabled else "false"


def search_and_show(title, wait=0.8):
    res = mem.search(QUERY, filters={"user_id": "u1"}, top_k=2)["results"]
    time.sleep(wait)  # let the fire-and-forget write-back land
    print(f"\n{title}")
    for rank, r in enumerate(res, 1):
        print(
            f"   {rank}. score={r['score']:.3f}  access_count={r.get('access_count', 0)}"
            f"  {r['memory'][:52]}"
        )
    return res


print("=" * 78)
print("SETUP: two memories, both relevant, different age and similarity")
print("  stale -> cosine 1.00 with the query, created 365 days ago")
print("  fresh -> cosine 0.60 with the query, created today")
print("=" * 78)

set_decay(False)
before = search_and_show("A) decay OFF — relevance only")
assert before[0]["score"] > before[1]["score"]
assert "Berlin" in before[0]["memory"], "stale high-similarity memory should win on relevance"

set_decay(True)
after = search_and_show("B) decay ON — recency reorders the same two memories")
assert "Lisbon" in after[0]["memory"], "fresh memory should outrank the stale one"
print("   -> order flipped; nothing was deleted (both still returned)")

print("\n" + "=" * 78)
print("C) reinforcement: retrieve 4 more times, then look again")
print("=" * 78)
for _ in range(4):
    mem.search(QUERY, filters={"user_id": "u1"}, top_k=2)
    time.sleep(0.5)

final = search_and_show("D) after 5 retrievals — the frequently-used memory climbs back")
assert "Berlin" in final[0]["memory"], "repeatedly-retrieved memory should rise"
counts = "\n".join(
    f"     {r['memory'][:52]} -> access_count={r.get('access_count')}" for r in final
)
print(f"\n   access_count now:\n{counts}")

set_decay(False)
print("\n" + "=" * 78)
print("E) decay OFF again — pure relevance is restored immediately")
print("=" * 78)
restored = search_and_show("   (no decay)", wait=0.2)
assert "Berlin" in restored[0]["memory"]
assert restored[0]["score"] > restored[1]["score"]

vs.delete_col()
print("\nALL FUNCTIONAL CHECKS PASSED")
