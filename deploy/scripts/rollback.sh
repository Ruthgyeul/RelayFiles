#!/usr/bin/env bash
# Puts app and worker back on an earlier release's images (Docker Compose deployment) and lifts
# maintenance mode once /api/health says "ok":
#   deploy/scripts/rollback.sh          the newest release in DATA_DIR/releases.log that is not running now
#   deploy/scripts/rollback.sh <tag>    a tag from releases.log (autoclean keeps the newest IMAGE_KEEP)
# After a failed release.sh (maintenance stays on) the default is the release that was live before it.
# Only the images change; the schema stays as it is (expand → contract, docs/runbook.md "롤백").
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

FLAG="$ROOT/deploy/maintenance/on"
PORT="$(env_value NGINX_LISTEN_PORT 80)"
RELEASES="$(env_value DATA_DIR /srv/relayfiles)/releases.log"

# The tag the app container runs now (empty when it is not running).
APP_CONTAINER="$("${COMPOSE[@]}" ps -q app 2> /dev/null || true)"
CURRENT=""
if [ -n "$APP_CONTAINER" ]; then
  CURRENT="$(docker inspect --format '{{.Config.Image}}' "$APP_CONTAINER")"
  CURRENT="${CURRENT##*:}"
fi

TARGET="${1:-}"
if [ -z "$TARGET" ] && [ -f "$RELEASES" ]; then
  TARGET="$(awk '{ print $2 }' "$RELEASES" | tac | awk -v current="$CURRENT" '$0 != current { print; exit }')"
fi
[ -n "$TARGET" ] || { echo "No release to roll back to; pass a tag (tail $RELEASES, docker image ls relayfiles-app)." >&2; exit 1; }

mapfile -t IMAGES < <(RELEASE_TAG="$TARGET" "${COMPOSE[@]}" config --images app worker | sort -u)
for image in "${IMAGES[@]}"; do
  docker image inspect "$image" > /dev/null 2>&1 || { echo "Image $image is gone (autoclean keeps IMAGE_KEEP releases); pick another tag." >&2; exit 1; }
done

log "Rolling app and worker back: ${CURRENT:-not running} → $TARGET"
RELEASE_TAG="$TARGET" "${COMPOSE[@]}" up -d --no-build app worker

log "Health check"
if ! wait_healthy "http://127.0.0.1:$PORT/api/health"; then
  echo "$TARGET did not become healthy either; maintenance mode is left as it is." >&2
  echo "Logs: ${COMPOSE[*]} logs --tail 200 app worker" >&2
  exit 1
fi
rm -f "$FLAG"
# One-off commands without RELEASE_TAG use :latest, which now names the running release again.
for image in "${IMAGES[@]}"; do docker tag "$image" "${image%:*}:latest"; done
log "$TARGET is live (maintenance mode off)."
