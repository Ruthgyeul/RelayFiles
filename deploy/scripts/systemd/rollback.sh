#!/usr/bin/env bash
# Points the app back at an earlier bundle, restarts it and lifts maintenance mode once
# /api/health says "ok" (systemd deployment):
#   deploy/scripts/systemd/rollback.sh            previous bundle
#   deploy/scripts/systemd/rollback.sh <bundle>   a bundle from `ls .app`
# After a failed release.sh (maintenance stays on) the previous bundle is the one that was live.
# Only the app bundle changes. If the release also migrated the database, restore the
# backup taken before it (docs/runbook.md "롤백"); the worker runs from the checkout, so
# `git checkout <commit> && npm ci` before restarting it when its code must go back too.
set -euo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

FLAG="$ROOT/deploy/maintenance/on"
PORT="$(env_value APP_PORT 3000)"
CURRENT="$(readlink "$APP_BUNDLES/current" || true)"
TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  # The newest bundle that is not the current one.
  mapfile -t BUNDLES < <(newest_first "$APP_BUNDLES"/[0-9]*-*)
  for bundle in "${BUNDLES[@]}"; do
    if [ "${bundle##*/}" != "$CURRENT" ]; then TARGET="${bundle##*/}"; break; fi
  done
fi
if [ -z "$TARGET" ] || [ ! -f "$APP_BUNDLES/$TARGET/server.js" ]; then
  echo "No bundle to roll back to (ls $APP_BUNDLES)." >&2
  exit 1
fi

log "Rolling back $CURRENT → $TARGET"
ln -sfn "$TARGET" "$APP_BUNDLES/current.next"
mv -T "$APP_BUNDLES/current.next" "$APP_BUNDLES/current"
sudo systemctl restart relayfiles-app

log "Health check"
if ! wait_healthy "http://127.0.0.1:$PORT/api/health"; then
  echo "$TARGET did not become healthy either; maintenance mode is left as it is." >&2
  echo "Logs: journalctl -u relayfiles-app -n 200" >&2
  exit 1
fi
rm -f "$FLAG"
log "relayfiles-app now runs $TARGET (maintenance mode off)."
