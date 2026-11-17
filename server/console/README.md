# Mem0 Console（独立控制台）

自托管 Mem0 的全新 Web 控制台，**替换官方 `server/dashboard`**。它消费同一套
FastAPI 接口，但技术栈、信息架构与视觉都是独立实现的：Vite + React 19 + TypeScript +
Tailwind CSS v4 + TanStack Query。

```
┌────────────┐   /api/*   ┌──────────────┐   /memories…   ┌────────────┐
│  Browser   │──────────▶│ nginx (SPA)  │───────────────▶│ mem0-server │
│  (console) │  same-origin └──────────────┘               └────────────┘
└────────────┘        httpOnly refresh cookie
```

## 功能

| 模块 | 内容 |
|---|---|
| 记忆库 | 列表/卡片两种视图、按实体/分类/审核状态筛选、语义搜索（可开重排）、详情编辑正文/分类/到期日、历史记录、批量改分类与到期日、批量删除、新建记忆（自动抽取 / 手动录入直写） |
| 记忆审核 | 管理员逐条通过/驳回，按临时/永久记忆（有无到期日）与分类筛选，支持批量通过/驳回、编辑正文/分类/到期日、恢复与彻底删除；已通过的记忆不再出现在审核列表 |
| 记忆地图 | 分类分布 + 共现关系力导向图，点击分类跳转筛选 |
| 分类 | 浏览目录、启用/停用、编辑描述与判定规则、分类器试运行 |
| 请求日志 | API 审计（方法/路径/状态/耗时/认证方式） |
| 用量 | LLM/嵌入/重排的 token 统计（按天/月/用户/操作/模型，含缓存命中） |
| 实体 | user/agent/run 及其记忆数，级联删除 |
| API 密钥 | 创建（一次性展示完整 key）、吊销 |
| 配置 | LLM/嵌入/重排/向量库覆盖、真实连通性测试、decay 开关、默认到期日、自定义指令 |
| 用户 | 管理员创建账号、角色（admin/user）、绑定 `memory_scope`、启停与删除 |
| 设置 | 资料、改密、浅色/深色主题 |

权限模型：管理员可见全部管理页与全部记忆；普通用户（`role=user`）只能看到
`memory_scope` 对应 `user_id` 的记忆，服务端强制生效（见 `server/main.py` 与
`server/routers/users.py`）。

## 本地开发（不需要 Docker）

```bash
cd server/console
pnpm install
pnpm mock          # 终端 A：内存 API 模拟服务，:9200
pnpm dev           # 终端 B：Vite，:3001（/api 代理到 :9200）
```

打开 http://127.0.0.1:3001 ，用 mock 账号登录：

| 账号 | 密码 | 角色 | 可见范围 |
|---|---|---|---|
| admin@example.com | admin12345678 | 管理员 | 全部 |
| user@example.com | user12345678 | 普通用户 | `hermes-user-2` |

`MOCK_EMPTY=1 pnpm mock` 可从零用户启动，用来走首次部署向导。

对接真实服务端（Docker 栈，API 在 :6688 或 :8888）：

```bash
VITE_DEV_API_TARGET=http://127.0.0.1:8888 pnpm dev
```

## 构建与测试

```bash
pnpm typecheck
pnpm build
pnpm test
```

## 部署

控制台镜像分两段：Node 构建静态资源 → nginx 提供服务，并把 `/api/*` 反代到
`API_UPSTREAM`（默认 `http://mem0-server:8000`）。同源部署让刷新令牌 cookie 始终保持
第一方，不需要 CORS，也不需要把 API 地址注入前端。

### Docker Compose（仓库内）

- 开发栈：`cd server && docker compose up -d` → 控制台 http://localhost:3000
- NAS 部署：`cd deploy && docker compose up -d --build` → http://<NAS_IP>:3000

### 单独构建

```bash
cd server/console
docker build -t mem0-console .
docker run --rm -p 3000:80 -e API_UPSTREAM=http://host.docker.internal:8888 mem0-console
```

### 运行期变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `API_UPSTREAM` | `http://mem0-server:8000` | nginx 反代目标（服务端根地址，不要带 `/api`） |
| `VITE_INSTANCE_NAME` | `Mem0` | 品牌名，**构建期**注入（改完需重新 build） |

### 登录态与兼容性

- 后端在 `/auth/login`、`/auth/register`、`/auth/refresh` 上同时返回 token 并下发
  `mem0_console_rt` httpOnly cookie；控制台只在内存里保存 access token，刷新走 cookie。
- 若服务端还是旧版（不下发 cookie），可临时开启
  `VITE_REFRESH_TOKEN_FALLBACK=true` 重新构建：刷新令牌会退化为 sessionStorage，
  牺牲一部分 XSS 防护，仅作过渡。
- 登出调用 `POST /auth/logout`（旧服务端没有该路由时本地清理仍生效）。

## 与官方 dashboard 的关系

`server/dashboard` 是上游自带的自托管面板，本仓库早期在其上做了中文定制；本目录是
另一套完全独立的实现，两者共享同一服务端与认证接口。迁移完成后可以只保留其中一套：
compose 文件已默认使用 `mem0-console`，dashboard 服务可删除。
