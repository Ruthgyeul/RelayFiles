#!/usr/bin/env bash
# Points the app back at an earlier bundle and restarts it (systemd deployment):
#   deploy/scripts/systemd/rollback.sh            previous bundle
#   deploy/scripts/systemd/rollback.sh <bundle>   a bundle from `ls .app`
# Only the app bundle changes. If the release also migrated the database, restore the
# backup taken before it (docs/runbook.md "롤백"); the worker runs from the checkout, so
# `git checkout <commit> && npm ci` before restarting it when its code must go back too.
set -euo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

CURRENT="$(readlink "$APP_BUNDLES/current" || true)"
TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  # The newest bundle that is not the current one.
  mapfile -t BUNDLES < <(newest_first "$APP_BUNDLES"/[0-9]*-*)
  for bundle in "${BUNDLES[@]}"; do
    if [ "${bundle##*/}" != "$CURRENT" ]; then TARGET="${bundle##*/}"; break; fi
  done
fi
[ -n "$TARGET" ] && [ -f "$APP_BUNDLES/$TARGET/server.js" ] || { echo "No bundle to roll back to (ls $APP_BUNDLES)." >&2; exit 1; }

log "Rolling back $CURRENT → $TARGET"
ln -sfn "$TARGET" "$APP_BUNDLES/current.next"
mv -T "$APP_BUNDLES/current.next" "$APP_BUNDLES/current"
sudo systemctl restart relayfiles-app
log "relayfiles-app now runs $TARGET."
