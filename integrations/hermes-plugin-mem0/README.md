# Mem0 for Hermes Agent（Hermes 记忆插件）

[中文](./README.md) · [English](./README.en.md)

为 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 提供持久记忆，后端是 [Mem0](https://mem0.ai)。

> 来自 `hh127/mem0` 分支。插件同时兼容上游 `mem0ai/mem0`；依赖分支侧支持的能力（分类过滤）
> 已在文中标注。

这是一个独立插件：回答前召回相关记忆，对话结束后抽取事实。它与 Hermes 自带的文件记忆并存，
支持 Mem0 Cloud、自托管 Mem0 服务端，或进程内 OSS SDK 三种后端。

## 特性

- 跨会话**自动召回**（回答前）与**自动捕获**（回答后抽取事实）。
- **4 个 agent 工具**：搜索、添加、更新、删除记忆。
- **三种后端模式**，通过 `hermes memory setup` 交互式配置。
- 记忆按**用户维度隔离**，写入时附带 agent 与 channel 元数据。

## 安装与配置

### 1. 安装

需要支持 memory-provider 插件的 Hermes Agent，以及 Python 3.11 或更高版本：

```bash
hermes plugins install hh127/mem0/integrations/hermes-plugin-mem0
hermes plugins enable mem0
```

支持插件依赖的 Hermes 安装器会依据本目录的 `pyproject.toml` 自动装 `mem0ai>=2.0.10,<3` 和
`httpx>=0.27,<1`。在较老的宿主（如 Hermes v0.21.3）上，需要手动把这两个依赖装进
**Hermes 的 Python 环境**。OSS 向导会按需补装其他 provider 包。

> 仍内置 Mem0 的 Hermes 版本会优先用内置 provider。请使用已完成「独立 provider 迁移」的 Hermes
> 版本；只装本插件并不会替换内置实现。迁移细节见[老用户与迁移](#老用户与迁移)。

### 2. 配置

```bash
hermes memory setup mem0
```

在交互式终端里运行并选择后端：

| 模式 | 需要什么 |
|------|----------------|
| **Platform**（默认） | [app.mem0.ai](https://app.mem0.ai/dashboard/api-keys) 的 Mem0 API Key |
| **Self-hosted server** | 一个运行中的 [Mem0 服务端](../../server)、它的 URL，以及 API Key（若未关闭认证） |
| **OSS** | 一个 LLM、一个嵌入模型、一个向量库；不需要 Mem0 API Key |

自托管模式选 **Self-hosted server**，填 URL 和 API Key。请求走 `X-API-Key`，使用服务端的
`/search` 与 `/memories` 路由。设置了 `host` 就会选这个后端，除非 `mode` 是 `oss`。

进程内 SDK 模式选 **Open Source**。向导提供 OpenAI 或 Ollama，以及本地 Qdrant 或 PGVector。
自定义 OpenAI 兼容端点、部署名或 Qdrant 服务端需要手工配置。OSS 不走 Mem0 Cloud，
但数据仍会发往你配置的模型服务。再次运行 setup 可切换模式；切回 Platform 时记得清掉环境与
profile `.env` 里残留的 `MEM0_HOST`。

同 profile 下同进程的 Desktop 会话，在 OSS 设置一致时共享本地 Qdrant 存储：操作串行化，
最后一个会话释放后关闭存储。设置冲突会被拒绝且不改动现有记忆；改模型或凭据前先关掉活动会话。
需要多进程（比如 CLI 与 Desktop 同时）共用同一份存储时，请改用 Qdrant 服务端或自托管 HTTP API。

若宿主的 `hermes memory setup --help` 只接受一个 provider 参数，说明它会在插件运行前就拒绝
`--mode` / `--host` / `--oss-llm` 之类的选项。请用上面的交互式命令，或参考
[手工配置 profile 文件](https://docs.mem0.ai/integrations/hermes) 做无人值守安装。
重定向输入无法操作系统选择菜单，会回落到 Platform。

### 3. 验证

```bash
hermes memory status
```

然后开一个新的 Hermes 会话，让它记住一件事，再在之后的会话里用同一用户身份搜出来。

## 工具

| 工具 | 说明 | 参数 |
|------|-------------|------------|
| `mem0_search` | 按语义搜索记忆 | `query`；可选 `top_k`（默认 10，最大 50）、`rerank`、`categories`（数组，OR 语义） |
| `mem0_add` | 原样存入文本，不做事实抽取 | `content` |
| `mem0_update` | 修改某条记忆的正文 | `memory_id`、`text` |
| `mem0_delete` | 删除某条记忆 | `memory_id` |

`categories` 过滤要求后端的向量库支持数组成员判定 —— 本分支的 pgvector 过滤支持；上游标准
自托管服务端对任何 filters 形式都会返回 0 命中。召回时分类名以 `[分类名]` 前缀显示，
方便模型复用准确名称。

## 配置项

设置放在 `$HERMES_HOME/mem0.json`，Hermes 默认 home 是 `~/.hermes`。setup 通常把 API Key 写进
该 profile 的 `.env`。OSS 模式的 OpenAI LLM/嵌入 Key 与数据库凭据写在 OSS 配置里。
setup 会原子地写这两个文件，权限仅限属主。

| 键 | 默认值 | 说明 |
|-----|---------|-------------|
| `mode` | `platform` | `platform` 走 Cloud/服务端路由；`oss` 走进程内 SDK |
| `host` | 未设置 | 自托管服务端 URL；OSS 模式下忽略 |
| `user_id` | 网关用户 ID，其次 `hermes-user` | 设成固定值可在多个网关间共享记忆 |
| `agent_id` | `hermes` | 写入时附带的 agent 标识 |
| `rerank` | `false` | 自动召回与未显式指定 `rerank` 的工具搜索是否重排（本分支对自托管 `/search` 也会转发） |
| `sync_max_chars` | `450` | 送去自动抽取的每条用户/助手消息的最大字符数 |
| `oss` | `{}` | setup 写入的 OSS LLM、嵌入与向量库配置 |

`MEM0_AUTO_TTL_DAYS`（本分支新增，默认 `30`）设置自动捕获记忆的保留期；`0` 或 `off` 关闭过期。
通过 `mem0_add` 写入的事实永不过期。

`MEM0_MODE` / `MEM0_HOST` / `MEM0_USER_ID` / `MEM0_AGENT_ID` 提供环境变量默认值；文件里的非空设置
优先级更高。文件里没写 `api_key` 时，`MEM0_API_KEY` 作为 Cloud 或服务端密钥。

显式设置的 `user_id`（非 `hermes-user`）优先于网关自带的用户 ID。检索以该用户身份跨会话进行；
写入附带 `agent_id` 与 `metadata.channel`。

## 自动召回与自动捕获

召回最多等 3 秒，取与当前消息相关的记忆；结果来晚了，模型仍可自行调用 `mem0_search`。

一轮结束后，后台 worker 把用户消息与助手回复送去抽取。**所有模式下每条消息默认截断到 450 字符**，
优先在句边界切。按你模型的上下文上限调大 `sync_max_chars`。显式 `mem0_add` 调用则原样存文本。

捕获是尽力而为：上一轮同步在等待 5 秒后仍忙，新一轮就跳过，没有持久队列。后端连续失败 5 次会
暂停 2 分钟再重试。

优雅退出会等活动的召回与捕获 worker 结束再关闭后端，包括 Python 进程退出时。后端网络超时仍然
生效：自托管 HTTP 捕获读超时 120 秒、连接超时 30 秒，其他自托管 HTTP 操作为 30 秒。
强制终止（包括 Hermes 的 30 秒退出看门狗）仍可能打断未完成的写入。

## 老用户与迁移

保留 `memory.provider: mem0`、已有的 `mem0.json`、`MEM0_*` 设置、用户身份和 OSS 存储路径即可。
迁移插件位置不需要搬记忆，也不用重跑 setup。

自动迁移还需要 Hermes 侧配合：

1. 包含 [PR #114569 迁移支持](https://github.com/NousResearch/hermes-agent/pull/114569) 的 Hermes 构建。
2. 一条名为 `mem0` 的已审核 catalog 条目，指向 `https://github.com/mem0ai/mem0`，
   `subdir: integrations/hermes-plugin-mem0`，并带已审核的完整 commit SHA。
3. 移除 Hermes 内置的 Mem0 provider —— 否则它优先级更高。

以上就位后，Hermes 可在 `hermes update` 或 agent 启动时自动安装缺失的已配置 provider。
启动安装受 `security.allow_lazy_installs` 控制；禁用或离线时需手工安装。
只合并本目录并不会注册 catalog 条目、也不算完成 rollout。

插件支持 CLI 的 setup/status，不提供 Desktop 配置面板或 provider 专属 CLI 子命令。

## 排障

- **Mem0 不可用**：跑 `hermes memory status`。检查 API Key 与后端连通性；连续失败 5 次后断路器会等 2 分钟。
- **记忆缺失**：确认跨会话用的是同一用户身份，并检查 `sync_max_chars`。自动抽取可能漏掉事实；
  需要精确文本就用 `mem0_add`。
- **OSS 连接被拒**：检查配置的模型/向量服务，或本地 Qdrant 的文件权限。
- **嵌入维度不匹配**：初始化会失败且不删既有数据。恢复原来的嵌入模型/维度，或换一个新 collection
  并显式迁移数据。

## 开发

在 Mem0 仓库根目录，需已安装 `ruff` 和 `isort`：

```bash
ruff check integrations/hermes-plugin-mem0
isort --check-only --profile black integrations/hermes-plugin-mem0
```

在隔离的 Hermes profile 中用真实 CLI 与 Desktop 会话验证改动：记忆的增删改查、自动捕获与召回、
Desktop 会话重叠、以及重启后的持久性。

## 许可

Mem0 贡献部分为 [Apache-2.0](LICENSE)。包含来自
[Nous Research 独立 Mem0 provider](https://github.com/NousResearch/hermes-plugin-mem0/tree/3fc36950b2b7c19cdd81c6de99f10d2cbed850af)
的 MIT 代码；其原始许可与版权声明保留在 [LICENSE](LICENSE) 的第三方章节。
