#!/bin/sh
# Production entrypoint: apply database migrations before starting the API.
#
# The image used to start uvicorn directly, so migrations (e.g. 007/008 which add
# the token_usage table) were never applied to an existing deployment — usage
# collection silently logged errors and /usage/stats returned 500.
set -e

echo "[entrypoint] applying database migrations (alembic upgrade head)..."
attempt=0
until alembic upgrade head; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 10 ]; then
    echo "[entrypoint] migrations failed after ${attempt} attempts, aborting" >&2
    exit 1
  fi
  echo "[entrypoint] database not ready yet, retrying in 3s (${attempt}/10)" >&2
  sleep 3
done

echo "[entrypoint] starting: $*"
exec "$@"
