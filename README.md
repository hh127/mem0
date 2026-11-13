# Mem0 魔改版 · hh127 fork

[中文](./README.md) · [English](./README.en.md)

> **一句话**：这不是上游 Mem0 的镜像，而是一份**魔改分支**——基于
> [mem0ai/mem0](https://github.com/mem0ai/mem0)（Apache-2.0）源码，保留上游的 SDK / API /
> Docker 用法，把分类、衰减、到期日、重排、用量统计和 Dashboard 按「自托管、中文优先、
> 数据不出内网」的用法重做了一遍。

上游的官方 Mem0 主要服务托管云 / 多租户场景；自己部署一套时，真正需要的东西往往缺一半。
这个分支就是补这些缺口：**去掉云导流、默认关遥测、界面全中文**，并且所有魔改都落在源码里，
不依赖补丁脚本。

## 魔改清单（相对上游原版）

| 方向 | 上游原版 | 本魔改版 |
| --- | --- | --- |
| **分类体系** | 无此概念 | 18 个中文分类 + 判定规则（`server/categories.json`，单一事实来源）；写入时自动打标、改正文触发重打标、检索支持 `categories` 数组过滤；Dashboard 提供分类浏览 / 管理 / 测试，支持单条与批量改分类 |
| **记忆衰减** | 无（SDK 里不支持） | 原生搜索期衰减：0.3x–1.5x 重近因、14 天半衰期、重排后截断、异步写回访问记录；默认关闭，配置页一键开 |
| **到期日** | 字段存在但界面不可见 | 默认到期日（新记忆自动继承「创建日 + N 天」）+ 列表 / 详情可见可改 + 批量设置 |
| **重排** | 只有 LLM 打分式 | 通用第三方云重排 `CloudReranker`（`/v1/rerank` 协议：SiliconFlow、Jina、DashScope…），失败自动回退原顺序 |
| **LLM** | OpenAI 兼容端点 | 新增 opencode provider（自动注入中转要求的请求头）；配置页可填 Base URL / temperature / max_tokens，支持模型连通性测试 |
| **用量** | 无 | 抽取 / 嵌入 / 重排三模型真实 token 采集、缓存命中统计，按天 / 月 / 用户 / 操作聚合的用量页 |
| **Dashboard** | 英文、带官方云功能入口 | 全中文；记忆地图（分类分布 + 共现连线按强度配色）、语义搜索、详情直接编辑、按用户下拉筛选、批量操作；去掉云导流与销售外链 |
| **遥测** | 默认开启 | 默认关闭（`.env` 显式写 `MEM0_TELEMETRY=true` 才开） |
| **镜像** | 从 PyPI 装 `mem0ai` | 镜像内置本仓库的 mem0 包，支持第三方 LLM / 嵌入 / 重排端点 |
| **Agent 集成** | 无 | Hermes Agent 记忆插件：每轮自动召回 / 自动捕获、按分类过滤、分级 TTL |
| **部署** | 开发用 compose | GitHub Actions 构建双镜像（server + dashboard）；`deploy/` 提供 NAS 可直接跑的编排 |

## 魔改规模

截至 2026-11-14，相对上游基线 `94c3fe9f`（Python SDK 2.2.1 / TS SDK 3.3.1，2026-09-25）：

- **47 个自有提交**，97 个文件，**+11,659 / −1,036 行**
- 大头在 Dashboard（47 个文件，+5,159 行）与服务端（`server/main.py` +592 行、`usage_hooks.py` +346 行）

## 兼容性

- **SDK / API 兼容上游**：公开接口不变，新增能力都是 opt-in 的参数或新 provider，现有代码不用改。
- **默认行为可回退**：不配分类目录、不开 `MEM0_DECAY`、不选 `cloud_reranker` / `opencode` 时，
  与上游行为一致。
- **纯自托管**：不依赖官方云端点；不引导注册云服务。
- **升级不靠补丁**：所有改动都在源码里，`git merge upstream/main` 后重建镜像即可。

## 快速开始

### 1. 自托管栈（server + dashboard + postgres）

一条命令起栈、建管理员、签发首个 API Key：

```bash
cd server
cp .env.example .env      # 至少填 POSTGRES_PASSWORD、JWT_SECRET（openssl rand -hex 32）和 OPENAI_API_KEY
make bootstrap
```

或者手动起栈，再用浏览器向导完成初始化：

```bash
cd server && docker compose up -d     # dashboard: http://localhost:3000
```

[`deploy/docker-compose.yaml`](./deploy/docker-compose.yaml) 是同一套栈的生产编排：直接用
`ghcr.io/hh127/mem0-server:main` 镜像，`mem0-server` / `mem0-dashboard` / `mem0-postgres`
三件套，数据卷持久化（API 6688，Dashboard 3000），适合直接跑在 NAS / 服务器上。

### 2. 接上 Hermes Agent

```bash
hermes plugins install hh127/mem0/integrations/hermes-plugin-mem0
hermes plugins enable mem0
hermes memory setup mem0        # 选 Self-hosted server，填 URL 与 API Key
hermes memory status            # Plugin: installed / available
```

插件提供 4 个 agent 工具（`mem0_search` / `mem0_add` / `mem0_update` / `mem0_delete`），
按分类过滤，每轮**自动召回**与**自动捕获**（自动捕获的记忆按分级 TTL 过期，默认 30 天，
`MEM0_AUTO_TTL_DAYS` 可调或关闭；`mem0_add` 显式写入的长期记忆永不过期）。

容器化部署（含幂等部署脚本、端到端自测、重建后自动恢复）见
[`integrations/hermes-plugin-mem0/`](./integrations/hermes-plugin-mem0/README.md) 与
[deploy README](./integrations/hermes-plugin-mem0/deploy/README.md)。

### 3. 在代码里用 SDK

只用上游标准能力：直接装 PyPI / npm 包。

```bash
pip install mem0ai          # Python（上游版本）
npm install mem0ai          # Node（上游版本）
```

要用本分支的 SDK 改动（分类打标、搜索期衰减、CloudReranker、opencode provider），
装本仓库：

```bash
pip install "git+https://github.com/hh127/mem0.git"
# 或者在仓库根目录：pip install -e .
```

服务端 OpenAPI 文档在 `http://<host>:<映射端口>/docs`（`server/` 编排映射 8888，
`deploy/` 编排映射 6688；Dashboard 两者都是 3000）。SDK 通用用法、LLM / 嵌入配置仍以
上游文档 [docs.mem0.ai](https://docs.mem0.ai) 为准。

## 分类体系

本分支最核心的魔改。18 个分类定义在 [`server/categories.json`](./server/categories.json)
（含每个分类的边界说明与 `decision_rules` 判定规则），服务端据此在写入时给记忆打标：

```
个人信息   个人偏好   行为习惯   工作信息   工作项目   专业知识   技术能力   开发项目
设备环境   软件与服务 网络与基础设施 长期目标 短期任务 重要决策 关系与人物 重要事件
知识收藏   AI助手设置
```

约定：分类名原样返回 —— 不翻译、不改写、不新增、不输出同义词或大小写变体。

* **写入打标**：由服务端自动完成，记忆 payload 自带 `categories`。
* **检索过滤**：`filters={"categories": {"in": ["工作项目"]}}`（数组成员语义，需要支持数组
  感知过滤的 pgvector 实现，本分支已内置）。
* **修改重打标**：`PUT /memories/{id}` 改正文会重新触发分类判定。
* **自定义**：改 `server/categories.json` 后重启 `mem0-server` 即可；Dashboard 提供分类浏览 /
  管理 / 测试页。

## 仓库结构

```
mem0/              核心 SDK（分类、衰减、重排等魔改在这里）
server/            自托管 FastAPI 服务（分类目录 categories.json 在此）
server/dashboard/  Next.js 中文控制台
integrations/      编辑器 / Agent 集成，含 hermes-plugin-mem0
deploy/            生产用 compose 编排（hh127 镜像，NAS 可直接跑）
scripts/           回归与演示脚本（run_full_tests.sh、decay_demo.py）
docs/ skills/ cli/ evaluation/ tests/   上游（docs 为英文文档站）
```

## 测试与门禁

```bash
make test          # 单元测试
make test-full     # 全量回归（遥测感知分段跑，避免 posthog 撑爆内存）
```

CI：`.github/workflows/fork-tests.yml` 跑 pytest（`tests/memory` + 分类相关用例）与 Dashboard
typecheck；`.github/workflows/docker-build.yml` 负责 server / dashboard 双镜像构建。

## 与上游同步

* `origin` → `github.com/hh127/mem0`（本分支），`upstream` → `github.com/mem0ai/mem0`。
* 上游改动按需 `git fetch upstream && git merge upstream/main`；上游的安全修复建议及时合并。
* 本分支提交集中在 `server/`、`server/dashboard/`、`mem0/memory/`、
  `integrations/hermes-plugin-mem0/`，与上游重叠面小，冲突成本低。
* 魔改全部落在源码里，没有 patch 脚本 —— 升级镜像后行为不变。

## 许可与出处

Apache 2.0 —— 见 [LICENSE](./LICENSE)。上游项目 [mem0ai/mem0](https://github.com/mem0ai/mem0)，
论文引用：

```bibtex
@article{mem0,
  title={Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory},
  author={Chhikara, Prateek and Khant, Dev and Aryan, Saket and Singh, Taranjeet and Yadav, Deshraj},
  journal={arXiv preprint arXiv:2504.19413},
  year={2025}
}
```
