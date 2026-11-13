# Mem0 Modded Fork · hh127

[English](./README.en.md) · [中文](./README.md)

> **In one line**: this is not a mirror of upstream Mem0 — it is a **heavily modded fork** built on
> [mem0ai/mem0](https://github.com/mem0ai/mem0) (Apache-2.0). The SDK / API / Docker usage stays
> compatible with upstream, while categories, decay, expiration, reranking, usage accounting and the
> dashboard are reworked for self-hosting, Chinese-first UI and on-prem data.

Upstream Mem0 targets the hosted cloud / multi-tenant use case. A self-hosted single-tenant
deployment usually needs a different set of things, so this fork fills those gaps: **no cloud
signup funnel, telemetry off by default, fully Chinese UI**, and every modification lives in the
sources — no patch scripts.

## What is modded (vs upstream)

| Area | Upstream | This fork |
| --- | --- | --- |
| **Categories** | Not available | 18 Chinese categories + decision rules (`server/categories.json`, single source of truth); tagged on write, re-tagged when text is updated, `categories` array filters in search; dashboard pages to browse / manage / test, plus single and bulk re-tagging |
| **Decay** | Not supported | Native search-time decay: 0.3x–1.5x recency, 14-day half-life, reorder + truncate, async access write-back; off by default, one switch in the dashboard |
| **Expiration** | Field exists but invisible in UI | Default expiry for new memories (creation date + N days), visible/editable in list and detail view, bulk setting |
| **Rerank** | LLM-scoring reranker only | Generic `CloudReranker` for third-party `/v1/rerank` APIs (SiliconFlow, Jina, DashScope, …), falls back to input order on failure |
| **LLMs** | OpenAI-compatible endpoints | Added an `opencode` provider (injects relay-required headers); Base URL / temperature / max_tokens config with a model connectivity test |
| **Usage** | Not available | Real token accounting for the extraction / embedding / rerank models, cache-hit stats, usage page aggregated by day / month / user / operation |
| **Dashboard** | English, cloud funnel included | Fully Chinese; memory map (category distribution + co-occurrence edges shaded by strength), semantic search, inline editing, user dropdown filter, bulk operations; cloud funnel and sales links removed |
| **Telemetry** | On by default | Off by default (set `MEM0_TELEMETRY=true` to opt in) |
| **Image** | Installs `mem0ai` from PyPI | Ships the in-repo mem0 package, supports third-party LLM / embedding / rerank endpoints |
| **Agent integration** | None | Hermes Agent memory plugin: auto recall / auto capture each turn, category filtering, tiered TTL |
| **Deployment** | Dev compose only | GitHub Actions builds both images (server + dashboard); `deploy/` ships a NAS-ready compose |

## Scale of the mod

As of 2026-11-14, relative to upstream baseline `94c3fe9f` (Python SDK 2.2.1 / TS SDK 3.3.1,
2026-09-25):

- **47 own commits**, 97 files, **+11,659 / −1,036 lines**
- Most of it is the dashboard (47 files, +5,159) and the server (`server/main.py` +592,
  `usage_hooks.py` +346)

## Compatibility

- **SDK / API compatible with upstream**: public interfaces are unchanged; new abilities are opt-in
  parameters or new providers, so existing code keeps working.
- **Defaults fall back to upstream behaviour**: without a category catalog, without `MEM0_DECAY`,
  and without `cloud_reranker` / `opencode`, behaviour matches upstream.
- **Self-hosting only**: no dependency on official cloud endpoints, no signup funnel.
- **No patch scripts**: everything lives in the sources; `git merge upstream/main` and rebuild.

## Quickstart

### 1. Self-hosted stack (server + dashboard + postgres)

One command starts the stack, creates an admin and issues the first API key:

```bash
cd server
cp .env.example .env      # set at least POSTGRES_PASSWORD and OPENAI_API_KEY
make bootstrap
```

Or start the stack manually and finish setup in the browser wizard:

```bash
cd server && docker compose up -d     # dashboard: http://localhost:3000
```

[`deploy/docker-compose.yaml`](./deploy/docker-compose.yaml) is the production compose for the same
stack — it runs `ghcr.io/hh127/mem0-server:main` with `mem0-server` / `mem0-dashboard` /
`mem0-postgres` and persistent volumes (API 6688, dashboard 3000), meant to run straight on a NAS or
server.

### 2. Wire it into Hermes Agent

```bash
hermes plugins install hh127/mem0/integrations/hermes-plugin-mem0
hermes plugins enable mem0
hermes memory setup mem0        # choose Self-hosted server, then enter URL + API key
hermes memory status            # Plugin: installed / available
```

The plugin exposes four agent tools (`mem0_search` / `mem0_add` / `mem0_update` / `mem0_delete`),
supports category filtering, and does **automatic recall** and **automatic capture** each turn.
Auto-captured memories expire under a tiered TTL (30 days by default; tune or disable with
`MEM0_AUTO_TTL_DAYS`), while facts written explicitly via `mem0_add` never expire.

For containerised deployment (idempotent deploy script, end-to-end self-test, restore after a
container rebuild) see [`integrations/hermes-plugin-mem0/`](./integrations/hermes-plugin-mem0/README.md)
and the [deploy README](./integrations/hermes-plugin-mem0/deploy/README.md).

### 3. Use the SDK from code

Standard upstream capabilities only — install the PyPI / npm packages:

```bash
pip install mem0ai          # Python (upstream)
npm install mem0ai          # Node (upstream)
```

To use this fork's SDK changes (category tagging, search-time decay, CloudReranker, `opencode`
provider), install this repository:

```bash
pip install "git+https://github.com/hh127/mem0.git"
# or from a clone: pip install -e .
```

The server's OpenAPI docs live at `http://<host>:<published-port>/docs` (the `server/` compose
publishes 8888, `deploy/` publishes 6688; the dashboard is 3000 in both). SDK usage and LLM/embedder
configuration still follow the upstream docs at [docs.mem0.ai](https://docs.mem0.ai).

## Categories

The core modification of this fork. The 18 categories are defined in
[`server/categories.json`](./server/categories.json) (each with boundary notes, plus
`decision_rules`); the server tags memories on write:

```
个人信息   个人偏好   行为习惯   工作信息   工作项目   专业知识   技术能力   开发项目
设备环境   软件与服务 网络与基础设施 长期目标 短期任务 重要决策 关系与人物 重要事件
知识收藏   AI助手设置
```

Category names are returned verbatim — never translated, rewritten, invented, or varied by case.

* **Tagging on write** — done server-side; the memory payload carries `categories`.
* **Filtering** — `filters={"categories": {"in": ["工作项目"]}}` (array membership; needs an
  array-aware pgvector implementation, which this fork ships).
* **Re-tagging** — `PUT /memories/{id}` on the text re-runs category classification.
* **Customising** — edit `server/categories.json` and restart `mem0-server`; the dashboard offers
  browse / manage / test pages.

## Repository layout

```
mem0/              Core SDK (category, decay and rerank mods live here)
server/            Self-hosted FastAPI server (categories.json lives here)
server/dashboard/  Next.js Chinese dashboard
integrations/      Editor/agent integrations, including hermes-plugin-mem0
deploy/            Production compose (hh127 images, NAS-ready)
scripts/           Regression and demo scripts (run_full_tests.sh, decay_demo.py)
docs/ skills/ cli/ evaluation/ tests/   Upstream (docs is the English doc site)
```

## Tests and gates

```bash
make test          # unit tests
make test-full     # full regression (telemetry-aware, so posthog cannot blow up memory)
```

CI: `.github/workflows/fork-tests.yml` runs pytest (`tests/memory` plus category cases) and the
dashboard typecheck; `.github/workflows/docker-build.yml` builds both images.

## Syncing with upstream

* `origin` → `github.com/hh127/mem0` (this fork), `upstream` → `github.com/mem0ai/mem0`.
* Pull upstream changes as needed with `git fetch upstream && git merge upstream/main`; upstream
  security fixes are worth merging promptly.
* This fork's commits are concentrated in `server/`, `server/dashboard/`, `mem0/memory/` and
  `integrations/hermes-plugin-mem0/`, so overlap with upstream is small and conflicts stay cheap.
* Every modification lives in the sources — no patch scripts, so behaviour survives image upgrades.

## License and attribution

Apache 2.0 — see [LICENSE](./LICENSE). Upstream project
[mem0ai/mem0](https://github.com/mem0ai/mem0); cite:

```bibtex
@article{mem0,
  title={Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory},
  author={Chhikara, Prateek and Khant, Dev and Aryan, Saket and Singh, Taranjeet and Yadav, Deshraj},
  journal={arXiv preprint arXiv:2504.19413},
  year={2025}
}
```
