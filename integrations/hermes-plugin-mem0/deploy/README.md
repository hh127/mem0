# 把插件部署进运行中的 Hermes 容器

[中文](./README.md) · [English](./README.en.md)

`deploy_plugin.py` 把本目录的插件源码送进一个**已经在跑**的 Hermes 容器（例如 NAS 上的
`nousresearch/hermes-agent:latest`），就地替换镜像自带的 provider。

## 为什么必须换 bundled 目录，而不是用户插件目录

Hermes 发现 memory provider 的顺序（首个命中生效）：

1. **bundled** —— `/opt/hermes/plugins/memory/<name>/`（镜像层）
2. user —— `$HERMES_HOME/plugins/<name>/`（这里是 `/opt/data/plugins/<name>/`）
3. project —— `./.hermes/plugins/<name>/`（需显式开启）
4. pip entry points（`hermes_agent.memory_providers`）

因为 bundled 优先，对于镜像里已经存在的同名 provider，把插件复制到 `/opt/data/plugins/`
**完全不起作用**。（Hermes 这个次序是刻意的：provider 按名字选定，工作区里的目录不该遮蔽
随镜像发布的实现。）

两个要记住的后果：

* 必须覆盖容器里的 `/opt/hermes/plugins/memory/mem0/`。
* 这个路径在镜像层，所以改动能撑过 `docker restart`，但撑不过
  `docker compose up --force-recreate` / 换镜像。见下方[持久化](#持久化)。

## 用法

```bash
pip install paramiko

# 部署：上传 → 备份 → 替换 → 校验 md5 → 重启网关
python deploy_plugin.py --host 192.168.4.132 --port 922 --user hh127 \
    --password-env UGREEN_NAS_PASS

# 只替换、不动网关
python deploy_plugin.py --host ... --no-restart

# 只比对容器与本目录，不做任何改动
python deploy_plugin.py --host ... --verify-only
```

密码来源三选一：`--password`、环境变量 `$UGREEN_NAS_PASS`、或 `--env-file`（默认
`~/.hermes/.env`）里同名键。脚本里不硬编码任何凭据。

常用参数：`--container`（默认 `hermes`）、`--dest`（默认 `/opt/hermes/plugins/memory/mem0`）、
`--gateway-service`（默认 `/run/service/gateway-default`）、`--plugin-dir`。

## 脚本做了什么

1. 从上级目录读取 6 个插件文件。
2. 以 base64 分块上传到宿主的 `/tmp/mem0plug_<ts>/`。不用 SFTP/SCP：绿联宿主的 SFTP 子系统
   拒绝写入，所以脚本改用追加 `printf '%s' '<chunk>'` 再远端解码。
3. 把容器里当前的插件备份到 `/tmp/mem0-plugin-backup-<ts>/prev`。
4. 逐个 `docker cp` 新文件覆盖 bundled 目录。
5. 在**容器内**逐个校验 md5，不一致就中止并给出回滚提示。
6. 通过 s6（`/command/s6-svc -t`）重启网关让新模块被导入，然后打印 `s6-svstat`。

## 校验

```bash
docker exec hermes /opt/hermes/bin/hermes memory status          # Plugin: installed / available
docker exec hermes /opt/hermes/.venv/bin/python3 -c \
  "import sys; sys.path.insert(0,'/opt/hermes'); \
   from plugins.memory.mem0 import TOOL_SCHEMAS; \
   print(list(TOOL_SCHEMAS[0]['parameters']['properties']))"
```

第二条会打印当前生效的 `mem0_search` 参数 —— 快速确认新参数（如 `categories`）真的加载了。

回滚：

```bash
docker cp /tmp/mem0-plugin-backup-<ts>/prev/. hermes:/opt/hermes/plugins/memory/mem0/
docker exec hermes /command/s6-svc -t /run/service/gateway-default
```

## 自测

部署后，对着真实后端把插件每个面都过一遍：

```bash
docker cp selftest_plugin.py hermes:/tmp/
docker exec hermes /opt/hermes/.venv/bin/python3 /tmp/selftest_plugin.py
docker exec hermes rm -f /tmp/selftest_plugin.py
```

覆盖：配置解析、后端选择、4 个工具、自动召回（prefetch）、自动捕获（sync_turn）、参数校验、
越权守卫。所有写入都落到隔离用户 `__plugin_selftest__`（可用 `--user` 覆盖），结尾删除 ——
不会碰真实记忆。`sync_turn` 是异步的，脚本会等观察到捕获成功后才清理，所以一次跑几分钟。
退出码 0 = 全绿。

`mem0_search(categories=[...])` 过滤要求后端的向量库支持数组成员判定（本分支的 pgvector
数组感知过滤）。较老的自托管服务端对**任何** filters 形式都返回 0 命中 —— 这项失败时，
要连 mem0-server 镜像一起更新，而不只是插件。快速探测：

```bash
docker exec mem0-server sh -c \
  "grep -c categories /usr/local/lib/python3.12/site-packages/mem0/vector_stores/pgvector.py"
# 0 -> 太旧；>0 -> 已有数组感知过滤
```

## 持久化

替换发生在镜像层，容器重建（`docker compose up --force-recreate`、换镜像）后会丢。两种持久化方式。

**bind-mount（本仓库未采用）。** 把宿主目录挂到 bundled 路径上：

```yaml
services:
  hermes:
    volumes:
      - /volume1/docker/hermes/data/hermes-config/mem0-plugin:/opt/hermes/plugins/memory/mem0:ro
```

**数据卷副本 + entrypoint 恢复（本部署实际采用）。** 源码放数据卷，每次启动由
`/opt/data/hermes-config/scripts/fix-permissions.sh`（网关启动前以 root 执行，
不碰 compose 就能撑过镜像更新）复制到 bundled 目录：

```sh
MEM0_PLUGIN_SRC=/opt/data/hermes-config/mem0-plugin
MEM0_PLUGIN_DST=/opt/hermes/plugins/memory/mem0
if [ -d "$MEM0_PLUGIN_SRC" ] && [ -f "$MEM0_PLUGIN_SRC/__init__.py" ]; then
    cp -f "$MEM0_PLUGIN_SRC"/*.py "$MEM0_PLUGIN_SRC"/*.yaml "$MEM0_PLUGIN_DST"/ 2>/dev/null \
        && echo "fix-permissions: mem0 plugin restored from $MEM0_PLUGIN_SRC"
fi
```

宿主路径：`/volume1/docker/hermes/data/hermes-config/mem0-plugin/`（uid 10000，权限 644）。
更新插件 = 把新源码复制到这里 + 重启容器；`deploy_plugin.py` 只刷新**运行中**的容器，
所以数据卷副本也要同步更新（否则下次启动会被回退）。

**容器内的补丁块已退役。** 早期 `fix-permissions.sh` 里有几段为分支定制的
`sed`/python 补丁（自托管 `host=`、rerank 转发、分级 TTL）。这些定制现在都写在插件源码里，
所以每段补丁都在做无用功（各自先检查自己的 marker）。保留它们只是为了兜底那些仍带旧插件的镜像。

踩过的教训：**半应用的补丁比没有补丁更糟。** 有一段锚点在 `__init__.py` 匹配、在
`_backend.py` 不匹配，结果 `_add(infer=True)` 调用 `add(..., expiration_date=...)` 时后端没有
这个参数 —— 每轮自动捕获都抛 `TypeError`。别让补丁锚点和插件源码漂移；把改动合进源码，
让补丁自然失效。

## 坑

* **通配符在哪展开。** `docker exec hermes md5sum <dest>/*.py` 会在**宿主**展开通配符
  （宿主没这个路径）→ 字面量 `*.py` → 假的 `MISSING`。一律包一层 `sh -c "..."` 让容器展开。
* **`plugin.yaml` 的 `version` 不随功能更新。** 判断新旧要看 `__init__.py` 的大小/内容（或 md5），
  不是版本字符串。
* **`docker cp <staging>/.` 会把上传分片灌进去。** staging 里有 `<name>.b64`，`.` 会把目录内容
  全复制过去 → 插件目录混进 `.b64`。逐个文件 `docker cp`，或复制后 `rm -f <dst>/*.b64`。
* **给重启留时间。** s6 需要约 10 秒；刚发完信号就查 `memory status` 可能还是旧进程。
* **别污染 NAS。** staging/备份都放 `/tmp`，用完删掉（脚本会删 staging）；旧备份手动清理。
* **凭据不在这个脚本里。** 它只搬代码；API URL/Key 在 `config.yaml`（`memory.mem0.*`）和
  `$HERMES_HOME/mem0.json`。
