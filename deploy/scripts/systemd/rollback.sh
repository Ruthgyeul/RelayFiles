#!/usr/bin/env bash
# Points the app back at an earlier bundle, restarts it and lifts maintenance mode once
# /api/health says "ok" (systemd deployment):
#   deploy/scripts/systemd/rollback.sh            previous bundle
#   deploy/scripts/systemd/rollback.sh <bundle>   a bundle from `ls .app`
# After a failed release.sh (maintenance stays on) the previous bundle is the one that was live.
# The app, the worker and WebDAV go back together: they all run from the bundle. A bundle made
# before the worker ran from it has no tools/; it gets the current bundle's (hard links), so the
# units' WorkingDirectory (.app/current/tools) always exists, and only the app's code goes back.
# If the release also migrated the database, restore the backup taken before it
# (docs/runbook.md "롤백").
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

if [ ! -d "$APP_BUNDLES/$TARGET/tools" ]; then
  if [ -n "$CURRENT" ] && [ -d "$APP_BUNDLES/$CURRENT/tools" ]; then
    echo "Note: $TARGET has no tools/ (made before the worker ran from the bundle); it gets $CURRENT's, so the worker and WebDAV keep the newer code." >&2
    cp -al "$APP_BUNDLES/$CURRENT/tools" "$APP_BUNDLES/$TARGET/tools" 2> /dev/null || cp -a "$APP_BUNDLES/$CURRENT/tools" "$APP_BUNDLES/$TARGET/tools"
  else
    echo "Note: neither $TARGET nor the current bundle has tools/; the worker and WebDAV are not restarted." >&2
  fi
fi

log "Rolling back $CURRENT → $TARGET"
ln -sfn "$TARGET" "$APP_BUNDLES/current.next"
mv -T "$APP_BUNDLES/current.next" "$APP_BUNDLES/current"
UNITS=(relayfiles-app)
if [ -d "$APP_BUNDLES/$TARGET/tools" ]; then
  UNITS+=(relayfiles-worker)
  if dav_unit; then UNITS+=(relayfiles-dav); fi
fi
sudo systemctl restart "${UNITS[@]}"

log "Health check"
if ! wait_healthy "http://127.0.0.1:$PORT/api/health"; then
  echo "$TARGET did not become healthy either; maintenance mode is left as it is." >&2
  echo "Logs: journalctl -u relayfiles-app -u relayfiles-worker -n 200" >&2
  exit 1
fi
rm -f "$FLAG"
log "${UNITS[*]} now run $TARGET (maintenance mode off)."
