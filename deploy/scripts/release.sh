#!/usr/bin/env bash
# Releases the checked-out version: backup → build → maintenance on → migrate → restart →
# health check → maintenance off. Run on the server from the repository:
#   git pull && deploy/scripts/release.sh
# Rollback: docs/deploy-ubuntu.md ("롤백").
set -euo pipefail
source "$(dirname "$0")/lib.sh"

export RELEASE_TAG="${RELEASE_TAG:-$(git -C "$ROOT" rev-parse --short HEAD)}"
FLAG="$ROOT/deploy/maintenance/on"
PORT="$(env_value NGINX_LISTEN_PORT 80)"
HEALTH_TRIES="${HEALTH_TRIES:-30}"
RELEASES="$(env_value DATA_DIR /srv/relayfiles)/releases.log"

log "Release $RELEASE_TAG"
"${COMPOSE[@]}" up -d postgres redis

log "Backup"
"$ROOT/deploy/scripts/backup.sh"

log "Build images"
"${COMPOSE[@]}" build app worker

# Visitors see the static maintenance page while the schema changes; it is lifted on exit.
trap 'rm -f "$FLAG"' EXIT
touch "$FLAG"

log "Database migrations"
"${COMPOSE[@]}" run --rm tools npm run db:deploy

log "Restart app, worker and nginx"
"${COMPOSE[@]}" up -d --no-build app worker nginx
rm -f "$FLAG"

log "Health check"
for _ in $(seq 1 "$HEALTH_TRIES"); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" > /dev/null; then
    echo "$(date -u +%FT%TZ) $RELEASE_TAG" >> "$RELEASES"
    log "Release $RELEASE_TAG is live."
    exit 0
  fi
  sleep 2
done
echo "Health check failed. Logs: docker compose -f deploy/docker-compose.yml logs app worker" >&2
echo "Previous releases: $RELEASES (roll back with RELEASE_TAG=<tag> docker compose ... up -d app worker)" >&2
exit 1
