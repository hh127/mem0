# 测试流程（本 fork）

本文件只讲**这个 fork 怎么验**：改哪儿、跑哪条命令、哪些是 CI 门禁、哪些只能手工，以及
**怎么部署到绿联 NAS、部署后怎么验收**。
上游的通用贡献规则仍以 [`CONTRIBUTING.md`](CONTRIBUTING.md) 与 [`AGENTS.md`](AGENTS.md) 为准。

> 一句话：控制台改动跑 `pnpm typecheck && pnpm test && pnpm build`；服务端改动在 Docker 里跑
> `server/tests`；SDK 改动跑 `make test`。CI 门禁见 [`.github/workflows/fork-tests.yml`](.github/workflows/fork-tests.yml)。

## 1. 按改动选命令

| 改动位置 | 必须跑 | 备注 |
| --- | --- | --- |
| `server/console/` | `pnpm typecheck` → `pnpm test` → `pnpm build` | 前端类型、单测、产物打包 |
| `server/`（FastAPI / 审核接口） | Docker 内 `pytest tests -q`（见 §3） | 用 SQLite + FakeMemory，不依赖 Postgres |
| `mem0/`（SDK） | `make test`（见 §4） | 上游用例，需 hatch 环境 |
| `docs/` | 无自动测试；改了 `.mdx` 要同步 `docs/llms.txt` | 见 `docs-llms-txt-check.yml` |
| 只想快速看一眼 UI | `pnpm mock` + `pnpm dev`（见 §2） | 内存 API，30 秒起 |
| 部署到 NAS | 部署后按 §6.5 验收 | 脚本与主机参数只在 `deploy-local/` |

## 2. 控制台（`server/console`）

```bash
cd server/console
pnpm install        # 首次
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest，src/**/*.test.ts
pnpm build          # tsc + vite build
```

单测约定：纯函数放 `*-utils.ts` 并配 `*.test.ts`（现有 `batch.test.ts`、`review-utils.test.ts` 等）。
需要 DOM 的用例走 `jsdom`（`vite.config.ts` 已配）。

### 手动验收 / 预览

```bash
cd server/console
pnpm mock     # 终端 A：内存 API，http://127.0.0.1:9200
pnpm dev      # 终端 B：Vite，http://127.0.0.1:3001，/api 代理到 mock
```

- 账号：`admin@example.com` / `admin12345678`（管理员），`user@example.com` / `user12345678`（普通用户）。
- 连真实后端：`VITE_DEV_API_TARGET=http://127.0.0.1:8888 pnpm dev`。
- mock 数据每次重启重置；审核、编辑等操作只影响内存。
- 如果页面白屏且控制台报 `does not provide an export named ...`，是 Vite 缓存了旧模块，重启
  `pnpm dev` 即可（本仓库改完 `review-utils.ts` 这类被多处引用的文件后偶发）。

## 3. 服务端（`server/tests`）

测试自带 SQLite 与假 mem0 运行时（`tests/conftest.py`），**不需要** Postgres / Neo4j。

```bash
# 推荐：在 dev 镜像里跑（镜像只装了运行依赖，先补 pytest）
docker compose -f server/docker-compose.yaml run --rm --no-deps mem0 \
  sh -c "pip install -q pytest && python -m pytest tests -q"

# 只跑一个文件
docker compose -f server/docker-compose.yaml run --rm --no-deps mem0 \
  sh -c "pip install -q pytest && python -m pytest tests/test_review.py -q"
```

本机已有 Python 3.10+ 及服务端依赖时，也可以直接跑（`conftest.py` 会插入 `server/` 到 `sys.path`）：

```bash
cd server
PYTHONPATH=. python -m pytest tests -q
```

注意：测试会 monkeypatch `get_memory_instance`，不会连真实记忆库，也不会跑真实 LLM。

## 4. SDK（`mem0/`、仓库根 `tests/`）

```bash
make install_all    # 可选依赖，部分 provider 用例需要
make test           # pytest tests/
make test-py-3.11   # 固定 Python 版本（3.10 / 3.11 / 3.12）
pytest tests/llms/test_openai.py::test_generate_response   # 单个用例
```

约定见 [`tests/AGENTS.md`](tests/AGENTS.md)：文件名 `test_<module>.py`、mock provider SDK 而不是被测代码、
修 bug 先写一个会失败的回归用例。

## 5. CI 现状（重要）

- `.github/workflows/fork-tests.yml` 在 push/PR 上跑：
  - 全量 `pytest tests/ -q --ignore=tests/test_server_auth.py`（仓库根的 SDK 用例）；
  - `server/dashboard` 的 `pnpm typecheck`。
- ⚠️ 它**只收集仓库根 `tests/`**，不包含 `server/tests/`。也就是说
  `server/tests/`（含 `test_review.py`）目前不会在 CI 里执行，只能按 §3 手动跑。
  要纳入门禁需要修改 workflow，按 [`.github/AGENTS.md`](.github/AGENTS.md) 的规定先征得维护者同意。
- SDK 的其它流水线（`ci.yml`、`ci-gate.yml` 及各包 checks）由上游维护，按改动路径触发。

## 6. 部署到绿联 NAS 与部署后验收

### 6.1 文档与脚本在哪

| 内容 | 位置 | 是否提交 |
| --- | --- | --- |
| NAS 部署总说明（拓扑、流程 A–D、回滚、注意事项） | `deploy-local/README.md` | ❌ 本机文件，被 `.git/info/exclude` 忽略 |
| 升级脚本 | `deploy-local/nas-images-upgrade.sh`、`console-deploy.sh`、`ci-images-pull.sh` | ❌ 同上 |
| 隔离测试栈 | `deploy-local/optional-isolated-stack/` | ❌ 同上 |
| Hermes 插件部署进 NAS 容器 | [`integrations/hermes-plugin-mem0/deploy/README.md`](integrations/hermes-plugin-mem0/deploy/README.md) | ✅ |
| 通用自托管 compose（仓库内） | [`deploy/docker-compose.yaml`](deploy/docker-compose.yaml) | ✅ |

> `deploy-local/` 里有主机地址、账号和 provider key（`env.local`，600 权限），只留在本机；
> 不要把内容粘进提交、issue 或 CI 日志。提交进仓库的文档只写流程，不写主机参数。

### 6.2 选流程

| 场景 | 用哪个 |
| --- | --- |
| 服务端或控制台代码有改动，整机升级 | **流程 A**：`bash deploy-local/nas-images-upgrade.sh`（默认服务端 + 控制台；`--server` / `--console` 单选） |
| 只改前端，快速看效果 | **流程 B**：`bash deploy-local/console-deploy.sh`（`SKIP_BUILD=1` 复用已有 dist） |
| 放开手测试、不碰生产记忆 | **流程 C**：`deploy-local/optional-isolated-stack/` |
| 目标形态：CI 构建镜像 → NAS 只 pull | **流程 D**：`bash deploy-local/ci-images-pull.sh` |

当前 NAS 拓扑（细节见 `deploy-local/README.md`）：API `6688`；控制台两个入口 `3100`（compose 管理，
容器名仍是 `mem0-dashboard`）与 `3004`（`mem0-test-console` 别名）；Postgres `15432`；控制台 nginx
把 `/api/*` 同源反代到 `mem0-server:8000`。仓库内通用 compose（`deploy/`）是 API `6688` + 控制台 `3000`，
适合全新自托管部署。

### 6.3 开发循环：快路径 / 慢路径

只改 UI 时不要把整套镜像搬来搬去：本地跑 Vite，把 `/api` 代理到 NAS 上的后端即可。服务端、
依赖、Dockerfile、迁移这类改动则必须走真镜像。判断标准：

| 改动 | 快路径（分钟级） | 慢路径（真镜像 + 部署验收） |
| --- | --- | --- |
| 组件 / 文案 / 样式 / 交互 | ✅ 本地 `pnpm dev` + `VITE_DEV_API_TARGET` 指 NAS 后端 | 发版前仍需跑一次（验 nginx、静态资源、打包差异） |
| 新增/修改服务端接口（如审核） | 否：接口没上 NAS 前本地页面调不通 | ✅ 先部署服务端，再本地预览 UI |
| 依赖 / Dockerfile / nginx 模板 / 迁移 | 否 | ✅ 必须 |
| `mem0/` SDK | 本地单测 + Docker `server/tests` | ✅ 再看是否影响服务端行为 |

**快路径（只改 UI）**

```bash
cd server/console

# 生产 API：会写真实记忆，删改操作要确认对象
VITE_DEV_API_TARGET=http://<NAS>:6688 pnpm dev

# 更安全：指向隔离测试栈（流程 C，API 16688）
VITE_DEV_API_TARGET=http://<NAS>:16688 pnpm dev
```

- 浏览器开 `http://127.0.0.1:3001`；Vite 把 `/api/*` 同源代理到目标，refresh cookie 仍是
  `localhost` 第一方，登录态与线上一致。
- `/api/health` 在本地 dev 会 404——那是控制台 nginx 的桩接口（`return 200 'ok'`），不是后端路由，
  联调时不用管它。
- 若 NAS 前面有 TLS 且设了 `CONSOLE_COOKIE_SECURE=true`，本地 http 收不到 cookie：改用内网
  http 端口，或临时关掉该开关（记得改回去）。
- 快路径**验不了** nginx 反代、静态资源缓存与安全响应头，发版前仍要走一次真镜像 + §6.5。

**慢路径（服务端改动）**

```bash
bash deploy-local/nas-images-upgrade.sh --server    # 只换 mem0-server，控制台不动
```

这个脚本是在**生产镜像底座上做 overlay**（只替换 `server/` 与仓库内 `mem0/`），所以快，但依赖
版本沿用底座，可能与 CI 构建的镜像有差异。三条护栏：

1. 从**干净 commit** 构建（`git status` 为空），先记下 `git rev-parse HEAD`；
2. 记下实际运行的镜像（`docker inspect mem0-server --format '{{.Config.Image}}'`）与 digest，
   和 commit 一起写进部署记录；
3. 保留脚本自动打的 `pre-<时间戳>` 回滚 tag。

**验证通过后：先本地镜像还是拉云端？**

两种都行，但要留一个对账点：

- **等用户确认再拉云端**（默认）：先按 §6.5 验收；确认后跑
  `bash deploy-local/ci-images-pull.sh` 拉 GHCR 的 `:main` 并重建。
- **先用本地镜像**：可以继续用，但记一条「待对账」——等 CI 对**同一个 commit** 构建成功后再
  pull 一次并重建，避免 NAS 长期偏离 `main`。验收记录里注明当前是本地 overlay 镜像。

### 6.4 部署前

1. 本地按 §1–§4 全部通过；
2. 工作区干净（`git status`），改动已提交、CI 绿：
   `.github/workflows/fork-tests.yml`（Python 全量）与 `docker-build.yml`（三个镜像）；
3. 确认备份可写：流程 A/B/D 会打 `pre-<时间戳>` 镜像 tag、`pg_dump` 两个库、备份 compose 到
   `~/mem0-upgrade-<时间戳>/`（600 权限）。

### 6.5 部署后验收

`3100` 与 `3004` 两个入口都要过一遍（`<NAS>` 用 `deploy-local/env.local` 里的地址）：

1. `curl -fsS http://<NAS>:3100/` 与 `:3004/` 返回 200，且 `index.html` 引用的静态资源名是本次构建产物；
2. `curl -fsS http://<NAS>:3100/api/health` 正常——证明 nginx → API 的同源反代通；
3. API 直连 `http://<NAS>:6688/docs` 可打开；
4. 管理员登录 →「记忆库」能列出记忆，搜索/筛选可用；
5. 「记忆审核」计数与列表一致：通过一条 → 计数 −1；驳回一条 → 进入已驳回，记忆库默认视图与
   `POST /search` 都不再出现；
6. 「编辑」一条 →「保存并通过」，详情里正文 / 分类 / 到期日已更新；
7. 普通用户账号：只能看到 `memory_scope` 内的记忆，审核页不可见（会被重定向回记忆库）；
8. 刷新页面后仍是登录态，说明 httpOnly refresh cookie 正常；
9. 可选：按 6.6 切回 `pre-<时间戳>` 再切回当前版本，确认回滚可用。

### 6.6 回滚

见 `deploy-local/README.md` 的「回滚」小节。要点：镜像 `pre-<时间戳>`、数据库 dump 与 compose 备份都在
`~/mem0-upgrade-<时间戳>/`；Alembic 迁移只前不后，旧代码不读新列，所以通常只需换回旧镜像，不需要降级数据库。

### 6.7 注意

- `3100`/`3004` 连的是**生产** `mem0-server`：UI 里的改/删会直接作用到真实记忆；要放开手测试用流程 C。
- 普通用户必须绑定 `memory_scope`，且等于记忆的 `user_id`，否则 403。
- 控制台前面加 TLS 后，服务端要设 `CONSOLE_COOKIE_SECURE=true`，否则浏览器会拒收明文 HTTP 上的 cookie。

## 7. 手工验收清单：记忆审核

在 `pnpm mock` + `pnpm dev`（或真实后端）下逐条走一遍：

1. 写入一条新记忆 → 它出现在「记忆审核 → 待审核」，计数 +1。
2. 「临时记忆 / 永久记忆」筛选：有到期日的归临时，清空到期日归永久。
3. 「分类」筛选与关键词过滤只影响列表，不改数据。
4. 「编辑」：改正文、加/删分类、设置或清空到期日 → 「保存」后仍在队列；「保存并通过」后离开队列。
5. 「通过」→ 离开待审核队列，记忆库可见；语义检索仍能召回（审核不拦截待审核记忆）。
6. 「驳回」→ 进入已驳回页签，记忆库默认视图与 `POST /search` 都不再出现。
7. 「恢复通过」→ 回到记忆库；「彻底删除」→ 记录与历史一起消失，不可恢复。
8. 批量：全选本页 → 批量通过 / 批量驳回 / 彻底删除，失败项会留在选择里方便重试。

## 8. 没有 Python / Docker 时的降级检查

本机只有 Node 时，仍然可以拦住大部分问题：

```bash
cd server/console && pnpm typecheck && pnpm test && pnpm build   # 前端
node --check server/console/mock/server.mjs                       # mock 语法
python -m py_compile server/review.py server/main.py              # 任意 Python 3.10+ 可跑
```

再配合 mock 的 HTTP 冒烟（`/auth/login` → `/memories` → `/memories/{id}/review` → `/search`）
即可覆盖审核接口的主要行为；但**最终仍应在 Docker 里跑一次 `server/tests`**，那才是 CI 的等价环境。
