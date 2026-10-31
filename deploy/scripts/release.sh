#!/usr/bin/env bash
# Releases the checked-out version: backup → build → maintenance on → migrate (schema and
# data) → restart → health check (status ok) → maintenance off → tag :latest → clean up old images
# (autoclean.sh, AUTOCLEAN=0 skips it). Run on the server from the repository:
#   git pull && deploy/scripts/release.sh
# Once maintenance is on, only a healthy release lifts it: when a migration or the health check
# fails, visitors keep seeing the maintenance page and the script prints what to do next
# (deploy/scripts/rollback.sh, docs/deploy-ubuntu.md "단계별로 실패했을 때").
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

export RELEASE_TAG="${RELEASE_TAG:-$(git -C "$ROOT" rev-parse --short HEAD)}"
FLAG="$ROOT/deploy/maintenance/on"
PORT="$(env_value NGINX_LISTEN_PORT 80)"
RELEASES="$(env_value DATA_DIR /srv/relayfiles)/releases.log"
# The compose command, as printed in the hints below.
C="${COMPOSE[*]}"

# Which step is running: on a failure, the exit trap tells what changed and how to go on.
STAGE=prepare
on_exit() {
  local status=$?
  [ "$status" -eq 0 ] && return
  case "$STAGE" in
    prepare) echo "Release $RELEASE_TAG stopped before anything changed; the previous release is still serving." >&2 ;;
    migrate)
      cat >&2 << EOF

Migrations of $RELEASE_TAG failed. Maintenance mode stays on (visitors see the 503 page); the
previous containers still run, and the schema may be partly migrated.
  Status:  $C run --rm tools npx prisma migrate status
  Then:    fix the cause and run deploy/scripts/release.sh again (data and storage migrations resume),
           or reopen the previous release unchanged: rm deploy/maintenance/on
EOF
      ;;
    restart)
      cat >&2 << EOF

Release $RELEASE_TAG did not become healthy. Maintenance mode stays on (visitors see the 503 page).
  Logs:      $C logs --tail 200 app worker
  Health:    curl -fsS http://127.0.0.1:$PORT/api/health
  Roll back: deploy/scripts/rollback.sh   (the last release in $RELEASES; it lifts maintenance once healthy)
  Or fix and run deploy/scripts/release.sh again.
EOF
      ;;
  esac
}
trap on_exit EXIT

log "Release $RELEASE_TAG"
"${COMPOSE[@]}" up -d postgres redis

log "Backup"
"$ROOT/deploy/scripts/backup.sh"

log "Build images"
"${COMPOSE[@]}" build app worker

# Visitors see the static maintenance page while the schema changes.
STAGE=migrate
touch "$FLAG"

log "Migrations (schema, data, storage layout)"
"${COMPOSE[@]}" run --rm tools npm run db:deploy
"${COMPOSE[@]}" run --rm tools npm run data:migrate
"${COMPOSE[@]}" run --rm tools npm run storage:migrate

STAGE=restart
log "Restart app, worker and nginx"
"${COMPOSE[@]}" up -d --no-build app worker nginx

# Nginx keeps /api/health reachable in maintenance: visitors come back only once it says "ok".
log "Health check"
wait_healthy "http://127.0.0.1:$PORT/api/health"
rm -f "$FLAG"
STAGE=live
echo "$(date -u +%FT%TZ) $RELEASE_TAG" >> "$RELEASES"
# One-off commands without RELEASE_TAG ($C run --rm tools ...) use :latest, the live release.
mapfile -t BUILT < <(compose_images | sed -n "s/:$RELEASE_PROBE\$//p")
for repo in "${BUILT[@]}"; do docker tag "$repo:$RELEASE_TAG" "$repo:latest"; done
log "Release $RELEASE_TAG is live."
if [ "${AUTOCLEAN:-1}" != 0 ]; then
  "$ROOT/deploy/scripts/autoclean.sh" || echo "Cleanup failed; the release itself is live. Retry: deploy/scripts/autoclean.sh" >&2
fi
