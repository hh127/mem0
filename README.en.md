# Mem0 · Self-Hosted Fork (hh127)

[English](./README.en.md) · [中文](./README.md)

A self-hosting-first fork of [Mem0](https://mem0.ai): Chinese category taxonomy, search-time decay,
third-party reranking, a Chinese dashboard, and a [Hermes Agent](https://github.com/NousResearch/hermes-agent)
memory plugin.

> Tracks upstream [mem0ai/mem0](https://github.com/mem0ai/mem0) (Apache-2.0) — see
> [Syncing with upstream](#syncing-with-upstream). This fork is self-hosting only: no cloud signup
> funnel, telemetry off by default, Chinese-first UI and built-in category set.

## What this fork changes

| Area | This fork |
| --- | --- |
| **Categories** | 18 Chinese categories + decision rules (`server/categories.json`, single source of truth); server-side tagging on write, re-tagging on text update; search accepts `categories` array filters (array-aware pgvector, matching platform semantics) |
| **Decay** | Native search-time decay; expiry dates visible and configurable in the dashboard |
| **Rerank** | Generic third-party cloud rerank provider; dashboard search toggle plus rerank model / top_k config |
| **LLMs** | Added an `opencode` provider (injects the relay-required headers); Base URL / temperature / max_tokens config; model connectivity test |
| **Usage** | Token usage collection and a stats page for the three memory models (extraction / embedding / rerank) |
| **Dashboard** | Chinese UI; memory map (category distribution + co-occurrence edges shaded by strength); category browse / manage / test; semantic search, in-place editing, user dropdown filter |
| **Telemetry** | Off by default; cloud signup funnel removed |
| **Image** | Ships the in-repo mem0 package in the image; supports third-party LLM / embedding endpoints |
| **Hermes** | Standalone memory plugin `integrations/hermes-plugin-mem0/` (see below) |

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

`deploy/docker-compose.yaml` is an alternative compose file for the same stack — it runs the
`ghcr.io/hh127/mem0-server:main` image with `mem0-server` / `mem0-dashboard` / `mem0-postgres`
and persistent volumes, and is meant to run straight on a NAS or server.

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
and [`deploy/README.md`](./integrations/hermes-plugin-mem0/deploy/README.md).

### 3. Use the SDK directly (upstream)

```bash
pip install mem0ai          # Python
npm install mem0ai          # Node
```

The server's OpenAPI docs live at `http://<host>:<published-port>/docs` (the `server/` compose
publishes 8888, `deploy/` publishes 6688; the dashboard is 3000 in both). SDK usage, LLM/embedder
configuration and everything else still follow the upstream docs at
[docs.mem0.ai](https://docs.mem0.ai).

## Categories

The core difference of this fork. The 18 categories are defined in `server/categories.json`
(each with boundary notes, plus `decision_rules`); the server tags memories on write:

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
mem0/              Core SDK (this fork carries the category, decay and rerank changes)
server/            Self-hosted FastAPI server + dashboard (categories.json lives here)
integrations/      Editor/agent integrations, including hermes-plugin-mem0
deploy/            Compose for the self-hosted stack (hh127 image)
docs/              Documentation site sources (English)
skills/            Agent skills (upstream)
cli/ evaluation/ tests/ scripts/   Upstream
```

`make test` runs unit tests; `make test-full` runs the full regression entry point (telemetry-aware,
so posthog cannot blow up memory).

## Syncing with upstream

* `origin` → `github.com/hh127/mem0` (this fork), `upstream` → `github.com/mem0ai/mem0`.
* Pull upstream changes as needed with `git fetch upstream && git merge upstream/main`. This fork's
  commits are concentrated in `server/`, `server/dashboard/` and `integrations/hermes-plugin-mem0/`,
  so conflicts stay small.
* Every customisation (categories, decay, rerank, dashboard) lives in the sources — there are no
  patch scripts to re-apply, so behaviour survives image upgrades.

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
