#!/usr/bin/env bash
# Shared helpers for the deploy scripts. Values are read from .env without sourcing it
# (values such as "Seoul, KR" are not valid shell).
# The variables defined here are used by the scripts that source this file, not by it.
# shellcheck disable=SC2034

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

# compose_images → every image in docker-compose.yml (all profiles). The per-release tag reads
# RELEASE_PROBE, which tells the images built here (relayfiles-*) apart from the pinned ones.
RELEASE_PROBE="release-probe"
compose_images() { RELEASE_TAG="$RELEASE_PROBE" "${COMPOSE[@]}" --profile "*" config --images | sort -u; }

# status_ok BODY → true only when a /api/health body says the overall status is "ok". A degraded
# app (storage or Redis missing) still answers 200, so the HTTP status alone is not enough. The
# flat "components" object is dropped first: its entries carry their own "status"-like values.
status_ok() {
  # shellcheck disable=SC2001 # a regex, which ${body//…} cannot express
  sed 's/"components":{[^}]*}//' <<< "$1" | grep -q '"status":"ok"'
}

# health_ok URL → status_ok for the health endpoint at URL.
health_ok() {
  local body
  body="$(curl -fsS "$1")" || return 1
  status_ok "$body"
}

log() { printf '\033[1m==> %s\033[0m\n' "$*"; }

# systemd deployment (docs/deploy-systemd.md): the account that owns the SSD files and runs
# the services (created by setup-ssd.sh), and its home (npm cache for one-off commands).
STORAGE_USER="relayfiles"
STORAGE_HOME="/var/lib/relayfiles"
APP_BUNDLES="$ROOT/.app"

# newest_first PATH... → the PATHs that exist, newest modification time first, one per line.
newest_first() {
  local path
  for path in "$@"; do
    if [ -e "$path" ]; then printf '%s\t%s\n' "$(stat -c %Y -- "$path")" "$path"; fi
  done | sort -rn | cut -f2-
}

# keep_newest COUNT PATH... → removes all but the newest COUNT of PATHs (pass an unquoted glob).
keep_newest() {
  local count="$1" path old
  shift
  mapfile -t old < <(newest_first "$@" | tail -n +"$((count + 1))")
  for path in "${old[@]}"; do rm -rf -- "$path"; done
}

# offsite_env → exports the restic settings of .env (docs/runbook.md "오프사이트 백업"); false when
# RESTIC_REPOSITORY is empty, i.e. no offsite backup is set up.
offsite_env() {
  RESTIC_REPOSITORY="$(env_value RESTIC_REPOSITORY)"
  [ -n "$RESTIC_REPOSITORY" ] || return 1
  RESTIC_PASSWORD="$(env_value RESTIC_PASSWORD)"
  AWS_ACCESS_KEY_ID="$(env_value OFFSITE_ACCESS_KEY_ID)"
  AWS_SECRET_ACCESS_KEY="$(env_value OFFSITE_SECRET_ACCESS_KEY)"
  export RESTIC_REPOSITORY RESTIC_PASSWORD AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
}

# offsite_check → downloads and verifies OFFSITE_CHECK_PERCENT of the offsite repository (restic's
# own output goes to stderr). Prints why it failed; prints nothing when it passed or none is set up.
offsite_check() {
  offsite_env || return 0
  if ! command -v restic > /dev/null; then
    echo "restic is not installed (sudo apt install restic)"
    return 0
  fi
  log "Checking $(env_value OFFSITE_CHECK_PERCENT 5)% of the offsite repository" >&2
  restic check --read-data-subset="$(env_value OFFSITE_CHECK_PERCENT 5)%" >&2 || echo "restic check failed (see backup-verify.log)"
}

# compose_image SERVICE → the pinned image of a service in docker-compose.yml, so the k3s
# manifests run exactly what compose runs (one place to bump PostgreSQL, Redis and Nginx).
compose_image() {
  awk -v service="  $1:" '
    $0 == service { found = 1; next }
    found && /^  [a-z]/ { exit }
    found && $1 == "image:" { print $2; exit }
  ' "$ROOT/deploy/docker-compose.yml"
}
