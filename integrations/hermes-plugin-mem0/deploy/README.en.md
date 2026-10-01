# Deploying this plugin into a running Hermes container

[English](./README.en.md) · [中文](./README.md)

`deploy_plugin.py` ships the plugin sources in this directory into a Hermes
container that is already running (for example `nousresearch/hermes-agent:latest`
on a NAS), replacing the bundled provider in place.

## Why the bundled directory and not a user plugin dir

Hermes discovers memory providers in this order (first match wins):

1. **bundled** — `/opt/hermes/plugins/memory/<name>/` (image layer)
2. user — `$HERMES_HOME/plugins/<name>/` (here: `/opt/data/plugins/<name>/`)
3. project — `./.hermes/plugins/<name>/` (opt-in)
4. pip entry points (`hermes_agent.memory_providers`)

Because bundled wins, copying the plugin to `/opt/data/plugins/` does **nothing**
for a provider that already ships with the image. The reverse order (later source
wins) is deliberate in Hermes: a provider is selected by name, so a directory in
the working tree must never shadow a shipped one.

Two consequences to keep in mind:

* You must overwrite `/opt/hermes/plugins/memory/mem0/` in the container.
* That path lives in the image layer, so the change survives `docker restart`
  but **not** `docker compose up --force-recreate` / image upgrade. See
  [Persistence](#persistence) below.

## Usage

```bash
pip install paramiko

# deploy: upload -> backup -> replace -> verify md5 -> restart gateway
python deploy_plugin.py --host 192.168.4.132 --port 922 --user hh127 \
    --password-env UGREEN_NAS_PASS

# ship and replace, but leave the gateway alone
python deploy_plugin.py --host ... --no-restart

# compare the container against this directory without changing anything
python deploy_plugin.py --host ... --verify-only
```

The password is read from `--password`, `$UGREEN_NAS_PASS`, or the key of the
same name in `--env-file` (default `~/.hermes/.env`). Nothing is hardcoded.

Useful flags: `--container` (default `hermes`), `--dest`
(default `/opt/hermes/plugins/memory/mem0`), `--gateway-service`
(default `/run/service/gateway-default`), `--plugin-dir`.

## What the script does

1. Reads the six plugin files from the parent directory.
2. Uploads them as base64 chunks to `/tmp/mem0plug_<ts>/` on the host. SFTP/SCP
   are not used: on the UGREEN host the SFTP subsystem refuses to write, so the
   script appends `printf '%s' '<chunk>'` and decodes remotely.
3. Backs up the current container plugin to `/tmp/mem0-plugin-backup-<ts>/prev`.
4. `docker cp` the new files over the bundled directory.
5. Verifies every md5 **inside** the container and aborts with a rollback hint
   on mismatch.
6. Restarts the gateway via s6 (`/command/s6-svc -t`) so the new module is
   imported, then prints `s6-svstat`.

## Verifying

```bash
docker exec hermes /opt/hermes/bin/hermes memory status          # Plugin: installed / available
docker exec hermes /opt/hermes/.venv/bin/python3 -c \
  "import sys; sys.path.insert(0,'/opt/hermes'); \
   from plugins.memory.mem0 import TOOL_SCHEMAS; \
   print(list(TOOL_SCHEMAS[0]['parameters']['properties']))"
```

The second command prints the live `mem0_search` parameters — a quick way to
confirm a new argument (e.g. `categories`) is actually loaded.

Rollback:

```bash
docker cp /tmp/mem0-plugin-backup-<ts>/prev/. hermes:/opt/hermes/plugins/memory/mem0/
docker exec hermes /command/s6-svc -t /run/service/gateway-default
```

## Self-test

After deploying, exercise every plugin surface against the live backend:

```bash
docker cp selftest_plugin.py hermes:/tmp/
docker exec hermes /opt/hermes/.venv/bin/python3 /tmp/selftest_plugin.py
docker exec hermes rm -f /tmp/selftest_plugin.py
```

It checks config resolution, backend selection, the four tools, automatic recall
(`prefetch`), automatic capture (`sync_turn`), argument validation and the
ownership guard. All writes go to an isolated user (`__plugin_selftest__`,
override with `--user`) that is deleted at the end — real memories are never
touched. `sync_turn` is asynchronous and only cleaned up after capture is
observed, so the run takes a couple of minutes. Exit code 0 = all green.

`mem0_search(categories=[...])` filtering needs a backend whose vector store
understands array membership (this fork's pgvector array-aware filter). An older
self-hosted server returns zero hits for *every* filter shape — when that check
fails, update the mem0-server image too, not just this plugin. A quick probe:

```bash
docker exec mem0-server sh -c \
  "grep -c categories /usr/local/lib/python3.12/site-packages/mem0/vector_stores/pgvector.py"
# 0 -> too old; >0 -> array-aware filtering present
```

## Persistence

The replacement lives in the image layer, so it is lost on container recreate
(`docker compose up --force-recreate`, image upgrade). Two ways to survive that.

**Bind-mount (not used here).** Mount a host directory over the bundled path:

```yaml
services:
  hermes:
    volumes:
      - /volume1/docker/hermes/data/hermes-config/mem0-plugin:/opt/hermes/plugins/memory/mem0:ro
```

**Data-volume copy restored by the entrypoint (what this deployment uses).** Keep
the sources on the data volume and copy them over the bundled dir on every boot
from `/opt/data/hermes-config/scripts/fix-permissions.sh` (runs as root before
the gateway starts, so it survives image updates without touching compose):

```sh
MEM0_PLUGIN_SRC=/opt/data/hermes-config/mem0-plugin
MEM0_PLUGIN_DST=/opt/hermes/plugins/memory/mem0
if [ -d "$MEM0_PLUGIN_SRC" ] && [ -f "$MEM0_PLUGIN_SRC/__init__.py" ]; then
    cp -f "$MEM0_PLUGIN_SRC"/*.py "$MEM0_PLUGIN_SRC"/*.yaml "$MEM0_PLUGIN_DST"/ 2>/dev/null \
        && echo "fix-permissions: mem0 plugin restored from $MEM0_PLUGIN_SRC"
fi
```

Host side: `/volume1/docker/hermes/data/hermes-config/mem0-plugin/` (uid 10000,
mode 644). Updating the plugin = copy the new sources there + restart the
container; `deploy_plugin.py` refreshes the *running* container only, so update
the data-volume copy too (or the next boot reverts it).

**In-container patch blocks are retired.** Older `fix-permissions.sh` blocks
`sed`/python-patched the plugin for this fork (self-hosted `host=`, rerank
forwarding, tiered-retention TTL). Those customisations now live in the plugin
sources, so every block is a no-op (each checks for its own marker first). They
are kept only as a safety net for an image that still ships the old plugin.

The lesson from getting here: a half-applied patch is worse than none. An anchor
that matched `__init__.py` but not `_backend.py` left `_add(infer=True)` calling
`add(..., expiration_date=...)` on a backend without the parameter — automatic
capture raised `TypeError` on every turn. Never let patch anchors and the plugin
sources drift; fold the change into the sources and let the patch go inert.

## Pitfalls

* **Glob expansion location.** `docker exec hermes md5sum <dest>/*.py` expands
  the glob on the *host* (which has no such path) and yields a literal `*.py` →
  false `MISSING`. Always wrap in `sh -c "..."` so the container expands it.
* **`version` in `plugin.yaml` is not bumped per feature.** Compare `__init__.py`
  size/content (or md5) to tell builds apart, not the version string.
* **Allow time for the restart.** s6 needs ~10s; `memory status` right after the
  signal can still report the old process.
* **Don't pollute the NAS.** Keep staging/backup under `/tmp`, and remove the
  staging directory when done (the script does); delete old backups manually.
* **Provider credentials live elsewhere.** This script only moves code. The API
  URL/key stay in `config.yaml` (`memory.mem0.*`) and `$HERMES_HOME/mem0.json`.
