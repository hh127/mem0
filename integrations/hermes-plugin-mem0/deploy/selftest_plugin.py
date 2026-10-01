#!/usr/bin/env python3
"""End-to-end self-test for the deployed mem0 memory-provider plugin.

Run INSIDE the Hermes container, with the image venv:

    docker cp selftest_plugin.py hermes:/tmp/
    docker exec hermes /opt/hermes/.venv/bin/python3 /tmp/selftest_plugin.py
    docker exec hermes rm -f /tmp/selftest_plugin.py

It exercises every surface the plugin exposes to the agent — config resolution,
backend selection, the four tools, automatic recall (prefetch), automatic
capture (sync_turn), argument validation and the ownership guard — against the
configured mem0 backend.

Isolation: all writes go to a dedicated test user id (`--user`, default
`__plugin_selftest__`) which is deleted afterwards, so real memories are never
touched. sync_turn is asynchronous, so cleanup happens only after capture is
observed or the wait times out.

Exit code is 0 when every check passes, 1 otherwise.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

os.environ.setdefault("HERMES_HOME", "/opt/data")
sys.path.insert(0, "/opt/hermes")

RESULTS: list[tuple[str, bool, str]] = []
SERVER = ""
KEY = ""
TEST_USER = "__plugin_selftest__"


def rec(name: str, ok: bool, detail: object = "") -> None:
    RESULTS.append((name, bool(ok), str(detail)[:500]))
    print("%-4s %-36s %s" % ("PASS" if ok else "FAIL", name, str(detail)[:300]), flush=True)


def parse_env(path: str) -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        for line in open(path, errors="replace"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return out


def api(method: str, path: str, body=None, timeout: int = 90):
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    req = urllib.request.Request(SERVER + path, data=data, method=method,
                                 headers={"X-API-Key": KEY, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()
    except Exception as e:  # noqa: BLE001
        return None, "%s: %s" % (type(e).__name__, e)


def memories_for(user: str) -> str:
    _, body = api("GET", "/memories?user_id=%s" % user)
    return body or ""


def main() -> int:
    global SERVER, KEY, TEST_USER

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--user", default=TEST_USER, help="isolated test user id")
    ap.add_argument("--capture-wait", type=int, default=90, help="max seconds to wait for sync_turn capture")
    args = ap.parse_args()
    TEST_USER = args.user

    print("=" * 72)
    print("mem0 plugin self-test   user=%s" % TEST_USER)
    print("=" * 72)

    from agent.secret_scope import set_secret_scope
    set_secret_scope(parse_env("/opt/data/.env"), profile_home="/opt/data")
    from plugins.memory import load_memory_provider
    from plugins.memory.mem0 import TOOL_SCHEMAS, _load_config

    cfg = _load_config()
    SERVER = cfg.get("host") or ""
    KEY = cfg.get("api_key") or ""
    rec("config: host resolved", bool(SERVER), "host=%s" % SERVER)
    rec("config: api_key resolved", bool(KEY), "key=%s..." % KEY[:8])

    p = load_memory_provider("mem0")
    if p is None:
        rec("load_memory_provider", False, "returned None")
        return 1
    rec("load_memory_provider", p.name == "mem0", type(p).__name__)
    rec("is_available", p.is_available(), str(p.is_available()))

    p.initialize("selftest-session", user_id=TEST_USER, platform="cli")
    kind = type(p._backend).__name__
    rec("initialize: backend built", p._backend is not None, kind)
    rec("backend is self-hosted", kind == "SelfHostedBackend", kind)
    p._user_id = TEST_USER  # mem0.json may pin a real user; isolate this run

    names = [t["name"] for t in p.get_tool_schemas()]
    rec("tool schemas (4)", names == ["mem0_search", "mem0_add", "mem0_update", "mem0_delete"], names)
    props = set(TOOL_SCHEMAS[0]["parameters"]["properties"])
    rec("mem0_search params", {"query", "top_k", "rerank", "categories"} <= props, sorted(props))
    rec("system_prompt_block", "Mem0" in p.system_prompt_block(), "")

    marker = "SELFTEST-%d" % int(time.time())
    r = json.loads(p.handle_tool_call("mem0_add", {"content": "自检标记 %s：测试用户最喜欢的颜色是靛蓝色。" % marker}))
    rec("mem0_add", "error" not in r, r)
    time.sleep(2)

    mid, cats = None, []
    r = json.loads(p.handle_tool_call("mem0_search", {"query": "测试用户最喜欢的颜色"}))
    items = r.get("results", [])
    hit = next((i for i in items if marker in i.get("memory", "")), None)
    mid = hit["id"] if hit else (items[0]["id"] if items else None)
    cats = (hit or {}).get("categories", []) if hit else []
    rec("mem0_search", bool(items), "count=%s hit=%s" % (r.get("count"), bool(hit)))
    rec("search returns categories", isinstance(cats, list) and bool(cats), "categories=%s" % cats)

    # Categories filtering needs a backend whose vector store understands array
    # membership. A self-hosted server older than the pgvector array-aware
    # filtering commit returns zero hits for every filter shape.
    if cats:
        rf = json.loads(p.handle_tool_call("mem0_search", {"query": "颜色", "categories": [cats[0]]}))
        rec("search categories filter", "error" not in rf and rf.get("count", 0) > 0, str(rf)[:160])
        r0 = json.loads(p.handle_tool_call("mem0_search", {"query": "颜色", "categories": ["__no_such_category__"]}))
        rec("search bogus category -> 0", r0.get("count", -1) == 0 or "No relevant" in str(r0), str(r0)[:120])
    else:
        rec("search categories filter", False, "no categories on stored fact")

    if mid:
        ru = json.loads(p.handle_tool_call("mem0_update", {"memory_id": mid, "text": "自检标记 %s：颜色改成了朱红色。" % marker}))
        rec("mem0_update", "error" not in ru, str(ru)[:140])
        rv = json.loads(p.handle_tool_call("mem0_search", {"query": "最喜欢的颜色 朱红色"}))
        rec("update visible in search", "朱红" in json.dumps(rv, ensure_ascii=False), "count=%s" % rv.get("count"))
    else:
        rec("mem0_update", False, "no memory id from search")

    r = json.loads(p.handle_tool_call("mem0_update", {"memory_id": "00000000-0000-0000-0000-000000000000", "text": "x"}))
    rec("guard: unknown id rejected", "error" in r, str(r)[:140])

    body = p.prefetch("测试用户最喜欢的颜色是什么", session_id="selftest-session")
    rec("prefetch (automatic recall)", marker in body or "靛蓝" in body or "朱红" in body, repr(body)[:160])

    # sync_turn is asynchronous: poll until the captured fact lands.
    cap_marker = "AUTOCAP-%d" % int(time.time())
    p.sync_turn("请记住：自检自动捕获标记是 %s。" % cap_marker, "好的，已记下 %s。" % cap_marker,
                session_id="selftest-session")
    captured, waited = False, 0
    while waited < args.capture_wait:
        time.sleep(15)
        waited += 15
        if cap_marker in memories_for(TEST_USER):
            captured = True
            break
    rec("sync_turn (automatic capture)", captured, "after %ss" % waited)

    rec("reject missing param", "Missing" in p.handle_tool_call("mem0_add", {}), "")
    rec("reject unknown tool", "Unknown tool" in p.handle_tool_call("mem0_bogus", {"x": 1}), "")
    rec("reject bad top_k", "integer" in p.handle_tool_call("mem0_search", {"query": "x", "top_k": "abc"}), "")

    if mid:
        rd = json.loads(p.handle_tool_call("mem0_delete", {"memory_id": mid}))
        rec("mem0_delete", "error" not in rd, str(rd)[:120])

    try:
        p.shutdown()
    except Exception:  # noqa: BLE001
        pass

    st, _ = api("DELETE", "/entities/user/%s" % TEST_USER)
    rec("cleanup test user", st in (200, 204, 404), "HTTP %s" % st)

    ok = sum(1 for _, o, _ in RESULTS if o)
    print("=" * 72)
    print("TOTAL: %d/%d passed" % (ok, len(RESULTS)))
    for name, o, detail in RESULTS:
        if not o:
            print("  FAILED: %s -- %s" % (name, detail[:200]))
    print("=" * 72)
    return 0 if ok == len(RESULTS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
