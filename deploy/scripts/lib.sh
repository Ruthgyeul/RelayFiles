#!/usr/bin/env bash
# Shared helpers for the deploy scripts. Values are read from .env without sourcing it
# (values such as "Seoul, KR" are not valid shell).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ENV_FILE="${ENV_FILE:-$ROOT/.env}"
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE (copy .env.example and fill it in)." >&2; exit 1; }

# env_value KEY [DEFAULT] → the last KEY=value in .env, or DEFAULT.
env_value() {
  local value
  value="$(grep -E "^$1=" "$ENV_FILE" | tail -n 1 | cut -d= -f2-)"
  echo "${value:-${2:-}}"
}

COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT/deploy/docker-compose.yml")
# Extra SSD mounts (docs/runbook.md "볼륨 추가·교체").
if [ -f "$ROOT/deploy/docker-compose.volumes.yml" ]; then
  COMPOSE+=(-f "$ROOT/deploy/docker-compose.volumes.yml")
fi

log() { printf '\033[1m==> %s\033[0m\n' "$*"; }
