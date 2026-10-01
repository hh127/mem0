# Mem0 · 自托管分支（hh127 fork）

[中文](./README.md) · [English](./README.en.md)

面向自托管部署的 [Mem0](https://mem0.ai) 分支：自带中文分类体系、搜索期衰减、第三方重排、
中文 Dashboard，以及 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 记忆插件。

> 基于上游 [mem0ai/mem0](https://github.com/mem0ai/mem0)（Apache-2.0）持续同步（见
> [与上游同步](#与上游同步)）。本分支只走自托管路线：不引导注册官方云、默认关闭遥测、
> 界面与内置分类以中文为先。

## 相对上游改了什么

| 方向 | 本分支 |
| --- | --- |
| **分类** | 18 个中文分类 + 判定规则（`server/categories.json`，单一事实来源）；服务端写入时自动打标，改正文触发重打标；检索支持 `categories` 数组过滤（pgvector 数组感知，对齐商业版语义） |
| **衰减** | 搜索期衰减（native search-time decay），到期日可见、可配；Dashboard 里可调 |
| **重排** | 通用第三方云 rerank provider；Dashboard 搜索带「使用重排」开关，可配重排模型与 top_k |
| **LLM** | 新增 opencode provider（自动注入中转要求的请求头）；配置页支持 Base URL / temperature / max_tokens；模型连通性测试 |
| **用量** | 记忆系统三模型（抽取/嵌入/重排）token 用量采集与统计页 |
| **Dashboard** | 中文界面；记忆地图（分类分布 + 共现连线按强度配色）；分类浏览 / 管理 / 测试；记忆语义搜索、详情直接编辑、按用户下拉筛选 |
| **遥测** | 默认关闭；去掉官方云导流入口 |
| **镜像** | 镜像内置 in-repo mem0 包，支持第三方 LLM/嵌入端点 |
| **Hermes** | 独立记忆插件 `integrations/hermes-plugin-mem0/`（见下） |

## 快速开始

### 1. 自托管栈（server + dashboard + postgres）

一条命令起栈、建管理员、签发首个 API Key：

```bash
cd server
cp .env.example .env      # 至少填 POSTGRES_PASSWORD 和 OPENAI_API_KEY
make bootstrap
```

或者手动起栈，再用浏览器向导完成初始化：

```bash
cd server && docker compose up -d     # dashboard: http://localhost:3000
```

`deploy/docker-compose.yaml` 是同一套栈的另一种编排（直接用 `ghcr.io/hh127/mem0-server:main`
镜像，`mem0-server` / `mem0-dashboard` / `mem0-postgres` 三件套，数据卷持久化），
适合直接跑在 NAS / 服务器上。

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
[`integrations/hermes-plugin-mem0/`](./integrations/hermes-plugin-mem0/README.md)
与 [`deploy/README.md`](./integrations/hermes-plugin-mem0/deploy/README.md)。

### 3. 直接在代码里用（上游 SDK）

```bash
pip install mem0ai          # Python
npm install mem0ai          # Node
```

服务端 OpenAPI 文档在 `http://<host>:<映射端口>/docs`（`server/` 编排把 8000 映射到 8888，
`deploy/` 编排映射到 6688；dashboard 两者都是 3000）。SDK 用法、LLM/嵌入配置等仍以
上游文档 [docs.mem0.ai](https://docs.mem0.ai) 为准。

## 分类体系

本分支的核心差异。18 个分类定义在 `server/categories.json`（含每个分类的边界说明与
`decision_rules` 判定规则），服务端据此在写入时给记忆打标：

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
mem0/              核心 SDK（本分支含分类、衰减、重排等改动）
server/           自托管 FastAPI 服务 + Dashboard（categories.json 在此）
integrations/     各编辑器/Agent 集成，含 hermes-plugin-mem0
deploy/           自托管栈的 compose 编排（hh127 镜像）
docs/             文档站源码（英文）
skills/           Agent skills（上游）
cli/ evaluation/ tests/ scripts/   上游
```

`make test` 跑单元测试；`make test-full` 跑全量回归入口（遥测感知，避免 posthog 撑爆内存）。

## 与上游同步

* `origin` → `github.com/hh127/mem0`（本分支），`upstream` → `github.com/mem0ai/mem0`。
* 上游改动按需 `git fetch upstream && git merge upstream/main`；本分支提交集中在 `server/`、
  `server/dashboard/`、`integrations/hermes-plugin-mem0/`，冲突面小。
* 本分支的定制（分类、衰减、重排、Dashboard）都落在源码里，不依赖补丁脚本 ——
  升级镜像后行为不变。

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
