#!/usr/bin/env python3
"""Sync this Hermes memory-provider plugin into a running Hermes container.

Why a script instead of ``docker cp`` by hand
---------------------------------------------
The plugin is loaded from the *image layer* path
``/opt/hermes/plugins/memory/mem0`` (a "bundled" provider). Two consequences:

* Bundled providers take precedence over user plugins
  (``/opt/data/plugins/<name>``), so dropping a copy there is silently ignored.
  The bundled directory must be replaced in place.
* That directory is rebuilt from the image on every container recreate/upgrade,
  so the change is temporary unless you mount a directory over it (see README).

The host is a UGREEN NAS reached over SSH where ``scp``/SFTP cannot write to the
target paths, so files are shipped as base64 chunks appended to remote files.

Requires: ``pip install paramiko``.

Examples
--------
    # normal deploy (backs up, replaces, verifies, restarts the gateway)
    python deploy_plugin.py --host 192.168.4.132 --port 922 --user hh127 \
        --password-env UGREEN_NAS_PASS

    # ship + replace but do not touch the gateway
    python deploy_plugin.py --host ... --no-restart

    # only compare local vs container md5, change nothing
    python deploy_plugin.py --host ... --verify-only
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import os
import sys
import time
from pathlib import Path

try:
    import paramiko
except ImportError:  # pragma: no cover
    sys.exit("paramiko is required:  pip install paramiko")

# Files that make up the plugin. README/LICENSE/tests are repo-only.
PLUGIN_FILES = [
    "__init__.py",
    "_backend.py",
    "_openai_llm.py",
    "_oss_providers.py",
    "_setup.py",
    "plugin.yaml",
]

DEFAULT_CONTAINER = "hermes"
DEFAULT_DEST = "/opt/hermes/plugins/memory/mem0"
DEFAULT_GATEWAY_SERVICE = "/run/service/gateway-default"
CHUNK = 3000  # base64 chars per SSH command


def md5_bytes(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def read_env_file(path: str) -> dict[str, str]:
    out: dict[str, str] = {}
    p = Path(os.path.expanduser(path))
    if not p.is_file():
        return out
    for line in p.read_text(errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


class Remote:
    """Thin wrapper around a paramiko client with a sudo helper."""

    def __init__(self, client: paramiko.SSHClient, password: str, verbose: bool = True):
        self.client = client
        self.password = password
        self.verbose = verbose

    def run(self, cmd: str, sudo: bool = False, timeout: int = 300) -> tuple[str, str]:
        full = f"echo '{self.password}' | sudo -S {cmd}" if sudo else cmd
        _, stdout, stderr = self.client.exec_command(full, timeout=timeout)
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        err = "\n".join(
            ln for ln in err.splitlines()
            if "password" not in ln.lower() and "[sudo]" not in ln.lower()
        )
        return out, err


def connect(host: str, port: int, user: str, password: str) -> Remote:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        host, port=port, username=user, password=password,
        timeout=30, banner_timeout=30, auth_timeout=30,
    )
    return Remote(client, password)


def upload(remote: Remote, staging: str, files: dict[str, bytes]) -> dict[str, str]:
    """Copy local blobs to *staging* on the remote host. Returns local md5 map."""
    remote.run(f"rm -rf {staging} && mkdir -p {staging}")
    local_md5: dict[str, str] = {}
    for name, data in files.items():
        local_md5[name] = md5_bytes(data)
        b64 = base64.b64encode(data).decode()
        remote.run(f"rm -f {staging}/{name}.b64")
        for i in range(0, len(b64), CHUNK):
            remote.run(f"printf '%s' '{b64[i:i + CHUNK]}' >> {staging}/{name}.b64")
        remote.run(f"base64 -d {staging}/{name}.b64 > {staging}/{name}")
    return local_md5


def container_md5(remote: Remote, container: str, dest: str, files: list[str]) -> dict[str, str]:
    # NOTE: the glob must expand *inside* the container. Writing
    #   docker exec <c> md5sum <dest>/*.py
    # lets the host shell expand it first (host has no such path) -> false MISSING.
    names = " ".join(f"{dest}/{n}" for n in files)
    out, _ = remote.run(
        f'docker exec {container} sh -c "md5sum {names}"', sudo=True
    )
    found: dict[str, str] = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 2:
            found[parts[1].rsplit("/", 1)[-1]] = parts[0]
    return found


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", required=True, help="remote host, e.g. 192.168.4.132")
    ap.add_argument("--port", type=int, default=22)
    ap.add_argument("--user", required=True)
    ap.add_argument("--password", help="SSH password (prefer --password-env)")
    ap.add_argument("--password-env", default="UGREEN_NAS_PASS",
                    help="env var holding the password (default: UGREEN_NAS_PASS)")
    ap.add_argument("--env-file", default="~/.hermes/.env",
                    help="optional KEY=VALUE file to load before resolving --password-env")
    ap.add_argument("--container", default=DEFAULT_CONTAINER)
    ap.add_argument("--dest", default=DEFAULT_DEST)
    ap.add_argument("--gateway-service", default=DEFAULT_GATEWAY_SERVICE)
    ap.add_argument("--no-restart", action="store_true", help="do not touch the gateway")
    ap.add_argument("--verify-only", action="store_true", help="compare md5 only, change nothing")
    ap.add_argument("--plugin-dir", default=str(Path(__file__).resolve().parent.parent),
                    help="directory holding the plugin sources (default: repo plugin dir)")
    args = ap.parse_args()

    env = read_env_file(args.env_file)
    password = args.password or os.environ.get(args.password_env) or env.get(args.password_env)
    if not password:
        return _fail(f"no password: pass --password or set {args.password_env}")

    plugin_dir = Path(os.path.expanduser(args.plugin_dir))
    files: dict[str, bytes] = {}
    for name in PLUGIN_FILES:
        p = plugin_dir / name
        if not p.is_file():
            return _fail(f"missing plugin file: {p}")
        files[name] = p.read_bytes()

    remote = connect(args.host, args.port, args.user, password)
    try:
        print(f"[*] container={args.container} dest={args.dest}")
        local_md5 = {n: md5_bytes(d) for n, d in files.items()}

        current = container_md5(remote, args.container, args.dest, PLUGIN_FILES)
        print("[*] current container md5:")
        for n in PLUGIN_FILES:
            print(f"      {n:<18} {current.get(n, 'MISSING')[:12]}")

        if args.verify_only:
            drift = [n for n in PLUGIN_FILES if current.get(n) != local_md5[n]]
            if drift:
                print(f"[!] differs from local: {', '.join(drift)}")
                return 2
            print("[+] container matches this plugin directory")
            return 0

        ts = time.strftime("%Y%m%d_%H%M%S")
        staging = f"/tmp/mem0plug_{ts}"
        print(f"[*] uploading to {staging} ...")
        got = upload(remote, staging, files)
        bad = [n for n in PLUGIN_FILES if got[n] != local_md5[n]]
        if bad:
            return _fail(f"upload corruption: {bad}")

        backup = f"/tmp/mem0-plugin-backup-{ts}"
        remote.run(f"rm -rf {backup} && mkdir -p {backup}", sudo=True)
        remote.run(f"docker cp {args.container}:{args.dest} {backup}/prev", sudo=True)
        print(f"[*] backup: {backup}/prev")

        # Copy the plugin files one by one: `docker cp {staging}/.` would also drop the
        # <name>.b64 upload shards into the plugin directory (they can never be imported,
        # but they litter the bundled provider dir and confuse later diffs).
        for name in PLUGIN_FILES:
            remote.run(f"docker cp {staging}/{name} {args.container}:{args.dest}/{name}", sudo=True)
        print("[*] replaced plugin files")

        after = container_md5(remote, args.container, args.dest, PLUGIN_FILES)
        bad = [n for n in PLUGIN_FILES if after.get(n) != local_md5[n]]
        if bad:
            print(f"[!] md5 mismatch after copy: {bad}")
            print(f"[!] rollback:  docker cp {backup}/prev/. {args.container}:{args.dest}/")
            return 1
        print("[+] md5 verified inside container")

        remote.run(f"rm -rf {staging}")

        if args.no_restart:
            print("[*] --no-restart set; gateway left running")
            return 0

        remote.run(
            f"docker exec {args.container} /command/s6-svc -t {args.gateway_service}",
            sudo=True,
        )
        time.sleep(10)
        status, _ = remote.run(
            f"docker exec {args.container} /command/s6-svstat {args.gateway_service}",
            sudo=True,
        )
        print("[*] gateway:", status.strip())
        print("[+] done. Verify with:  docker exec %s hermes memory status" % args.container)
        return 0
    finally:
        remote.client.close()


def _fail(msg: str) -> int:
    print(f"[x] {msg}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
