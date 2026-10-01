# Mem0 自托管服务端

[中文](./README.md) · [English](./README.en.md)

Mem0 提供自托管的 FastAPI 服务端 + 本地 Dashboard：默认即安全，支持 Dashboard 登录与 API Key，
OpenAPI 文档在 `/docs`。

> 这是 `hh127/mem0` 分支：自托管优先、中文界面与中文分类体系、默认关闭遥测。
> 产品总览见[仓库 README](../README.md)。

> **升级注意：** Postgres 镜像已从归档的 `ankane/pgvector:v0.5.1` 换成官方的
> `pgvector/pgvector:pg17`，并且 `POSTGRES_PASSWORD` 现在是必填环境变量。已有部署请先读
> [从 ankane/pgvector 迁移](#从-ankanepgvector-迁移到-pgvectorpgvector)。

## 快速开始

### 前置

复制示例 env，设置 Postgres 密码（必填）：

```bash
cd server
cp .env.example .env
# 编辑 .env —— 至少填 POSTGRES_PASSWORD 和 OPENAI_API_KEY
```

### 一键起栈（Agent-first）

一条命令起栈，终端直接打印管理员邮箱、密码和首个 API Key：

```bash
cd server
make bootstrap
```

它会把栈拉起来、等 API 与 Dashboard 就绪、创建首个管理员并签发首个 API Key。

> 生成的凭据只在 `=== Ready ===` 块里打印一次。关终端前先存好密码和 API Key —— API Key 之后无法找回。

> `make bootstrap` 会跳过设置向导，所以「使用场景 → 自定义指令」这一步不会执行。之后想补，
> 可以 `POST /configure` 传 `{"custom_instructions": "..."}`，或在全新安装上走浏览器流程。

也可以覆盖生成的凭据：

```bash
cd server
make bootstrap EMAIL=admin@company.com PASSWORD='strong-password' NAME='Admin'
```

需要机器可读输出：

```bash
cd server
OUTPUT=json make seed
```

收尾：

```bash
cd server && make down     # 停栈
cd server && make clean    # 清空全部数据（含 Postgres 卷）
```

### 浏览器起栈（Browser-first）

起栈后用浏览器向导完成初始化：

```bash
cd server
make up
```

然后打开 `http://localhost:3000` 走完设置向导。

## 安全默认值

- Dashboard 登录用 JWT。
- 程序化访问用 `X-API-Key`。
- 认证默认开启。
- `AUTH_DISABLED=true` 仅供本地开发，不要用于生产。

## 忘记密码

栈在运行时，从宿主机重置管理员密码：

```bash
cd server
make reset-admin-password EMAIL=admin@example.com PASSWORD='new-strong-password'
```

这是官方支持的找回方式。能拿到宿主机 shell 的人本来就有数据库和密钥的完整访问权，
所以这条命令不会扩大攻击面。

## 请求日志保留

`request_logs` 表只追加、随流量增长（10 req/s 约 86 万行/天），需要定期清理：

```bash
cd server
make prune-logs                               # 默认保留 30 天
make prune-logs REQUEST_LOG_RETENTION_DAYS=7  # 缩短窗口
```

生产环境把它挂到 cron 或 systemd timer。`created_at` 列带 BRIN 索引，大表上做区间删除也很便宜。

## 本地地址

- Dashboard：`http://localhost:3000`
- API：`http://localhost:8888`
- OpenAPI 文档：`http://localhost:8888/docs`

## Dashboard

本分支的界面以中文为先。登录后可用的页面：

- **请求（Requests）** —— API 调用的实时审计日志（方法、路径、状态、耗时）。
- **记忆（Memories）** —— 卡片/列表浏览记忆；语义搜索（可开「使用重排」）；就地修改正文与分类；
  按用户下拉筛选（选项来自 `/entities`）。
- **分类（Categories）** —— 浏览、管理（启用/停用）、测试 `server/categories.json` 里的分类体系，
  见下方[分类](#分类)。
- **记忆地图** —— 分类分布 + 共现关系图，连线按共现强度分档配色。
- **实体（Entities）** —— 列出所有拥有记忆的 `user_id` / `agent_id` / `run_id` 及条数；
  删除实体将级联删除其记忆。
- **API Keys** —— 创建、打标签、吊销按用户区分的密钥。
- **配置（Configuration）** —— 运行时覆盖 LLM / 嵌入 / 重排模型，含 Base URL、temperature、
  max_tokens 和模型连通性测试。改动持久化到应用数据库，重启后重新生效，并叠加在 `.env` 之上。
- **用量（Usage）** —— 记忆系统各模型（抽取 / 嵌入 / 重排）的 token 用量统计。
- **设置（Settings）** —— 账号资料与密码。

## 分类

本分支内置一套中文分类目录，作为服务端打标的**单一事实来源**，位于 `server/categories.json`：
18 个分类 + `decision_rules` 判定规则。写入时自动打标；修改记忆正文会重新判定分类；检索支持
`filters={"categories": {"in": [...]}}`（数组成员语义，依赖本分支内置的 pgvector 数组感知过滤）。
分类名一律原样返回 —— 不翻译、不改写。改完 JSON 重启 `mem0-server` 即生效。

## 遥测

**本分支默认关闭**（上游默认开启，与 Mem0 OSS 库一致）。下面的事件实现仍在，开启后每安装最多发两条
到与该库相同的匿名 PostHog 项目：

- `admin_registered` —— 首个管理员创建时触发（向导或直接调 API）。属性：邮箱域名、服务端版本、安装 UUID。
- `onboarding_completed` —— 设置向导走到最终成功态时触发。属性同上，外加运维填写的自由文本 `use_case`。
  纯 API 引导不会发这个事件。

想开启：`MEM0_TELEMETRY=true`。

## 安全响应头

Dashboard 对每条路径都设置以下响应头（见 `server/dashboard/next.config.mjs`）：

- `X-Frame-Options: DENY`
- `Content-Security-Policy: frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`

合起来可防 iframe 嵌入、MIME 类型嗅探和跨源 referrer 泄漏。需要更严可再套自己的反向代理。

## 从 ankane/pgvector 迁移到 pgvector/pgvector

`ankane/pgvector` 镜像已归档、不再维护。本次发布改用官方 `pgvector/pgvector:pg17`
（PostgreSQL 17，pgvector 0.8.0）。

**变化点：**

| | 之前 | 之后 |
|---|---|---|
| Docker 镜像 | `ankane/pgvector:v0.5.1` | `pgvector/pgvector:pg17` |
| PostgreSQL 版本 | 15 | 17 |
| pgvector 版本 | 0.5.1 | 0.8.0 |
| 凭据 | 硬编码 `postgres`/`postgres` | 由 `POSTGRES_USER` / `POSTGRES_PASSWORD` 环境变量驱动 |

### 全新安装（无历史数据）

不需要迁移。把 `.env.example` 复制成 `.env`，设置 `POSTGRES_PASSWORD`，然后：

```bash
cd server
make up
```

### 已有安装（保留数据）

PostgreSQL 17 无法直接读取 PostgreSQL 15 写出的数据文件，必须**先导出再导入**。

**1. 从旧容器导出数据**

旧栈仍在运行时：

```bash
cd server

# 导出全部数据库（mem0 记忆 + mem0_app 认证/配置数据）
docker compose exec -T postgres pg_dumpall -U postgres > mem0_backup.sql
```

确认导出文件非空：

```bash
ls -lh mem0_backup.sql
```

**2. 停旧栈并删除旧卷**

```bash
docker compose down

# 删掉旧的 Postgres 数据卷
docker compose down -v
```

> **警告：** `docker compose down -v` 会永久删除 `postgres_db` 卷。确认备份无误后再执行。

**3. 更新 `.env`**

Postgres 凭据不再硬编码在 `docker-compose.yaml`，需要在 `.env` 里补上（或确认与旧配置一致）：

```bash
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=postgres
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<your-password>    # 必填 —— 不填 compose 会拒绝启动
POSTGRES_COLLECTION_NAME=memories
```

如果之前就用默认的 `postgres`/`postgres`，设 `POSTGRES_PASSWORD=postgres` 即可保持一致。

**4. 只启动 Postgres**

先**只**起 Postgres —— 别起 mem0 API。API 启动时会跑 `alembic upgrade head`，
创建的空表会和恢复过程冲突。

```bash
docker compose up -d postgres
```

等健康检查通过：

```bash
docker compose exec -T postgres pg_isready -q && echo "ready" || echo "not ready"
```

**5. 恢复数据**

```bash
docker compose exec -T postgres psql -U postgres < mem0_backup.sql
```

可能会看到 `role "postgres" already exists` 之类的提示，无害。

> **重要：** 必须在启动 mem0 API 容器**之前**恢复数据。API 启动时会跑数据库迁移并创建空表，
> 之后再恢复会撞主键冲突，导致 API Key 和设置丢失。

**6. 启动 API**

现在可以启动 mem0 API 容器了。Alembic 会识别到已存在的表，只应用新增迁移：

```bash
docker compose up -d mem0
```

**7. 验证**

```bash
# 检查 API 健康
make health

# 确认记忆还在
curl -s http://localhost:8888/memories?user_id=<your-user-id> -H "X-API-Key: <key>"
```

### 回滚

需要回退时，把 `docker-compose.yaml` 里的镜像标签换回旧版：

```yaml
postgres:
    image: ankane/pgvector:v0.5.1
```

然后 `docker compose down -v`、`docker compose up -d --build`，用同样方式把
`mem0_backup.sql` 恢复到旧容器。

## 参考

更多产品与 API 文档见 [docs.mem0.ai](https://docs.mem0.ai/open-source/overview)。
