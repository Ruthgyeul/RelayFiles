#!/usr/bin/env bash
# Releases the checked-out version on the systemd deployment: backup → npm ci → build →
# copy the bundle to .app/<release> → maintenance on → migrate (schema, data, storage
# layout) → switch .app/current → restart → maintenance off → health check.
# Run on the server from the checkout, as the user who owns it:
#   git pull && deploy/scripts/systemd/release.sh
# The running app keeps serving from its own bundle while the new one builds.
set -euo pipefail
source "$(dirname "$0")/../lib.sh"

SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
RELEASE="$(date -u +%Y%m%d%H%M%S)-$SHA"
FLAG="$ROOT/deploy/maintenance/on"
PORT="$(env_value APP_PORT 3000)"
HEALTH_TRIES="${HEALTH_TRIES:-30}"
KEEP="${BUNDLE_KEEP:-3}"
RELEASES="$(env_value DATA_DIR /srv/relayfiles)/releases.log"
RF="$ROOT/deploy/scripts/systemd/rf.sh"

cd "$ROOT"
log "Release $RELEASE"

log "Backup"
"$ROOT/deploy/scripts/systemd/backup.sh"

log "Dependencies and build"
npm ci --no-audit --no-fund
npm run build

log "Bundle $APP_BUNDLES/$RELEASE"
mkdir -p "$APP_BUNDLES"
cp -a .next/standalone "$APP_BUNDLES/$RELEASE.partial"
# next build copies .env into the bundle; the app reads the checkout's .env instead.
rm -f "$APP_BUNDLES/$RELEASE.partial"/.env*
mkdir -p "$APP_BUNDLES/$RELEASE.partial/.next/cache"
sudo chown -R "$STORAGE_USER:$STORAGE_USER" "$APP_BUNDLES/$RELEASE.partial/.next/cache"
mv "$APP_BUNDLES/$RELEASE.partial" "$APP_BUNDLES/$RELEASE"

# Visitors see the static maintenance page while the schema changes; it is lifted on exit.
trap 'rm -f "$FLAG"' EXIT
touch "$FLAG"

log "Migrations (schema, data, storage layout)"
"$RF" db:deploy
"$RF" data:migrate
"$RF" storage:migrate

log "Switch to $RELEASE and restart"
ln -sfn "$RELEASE" "$APP_BUNDLES/current.next"
mv -T "$APP_BUNDLES/current.next" "$APP_BUNDLES/current"
sudo systemctl restart relayfiles-app relayfiles-worker
rm -f "$FLAG"

log "Health check"
for _ in $(seq 1 "$HEALTH_TRIES"); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" > /dev/null; then
    echo "$(date -u +%FT%TZ) $RELEASE" >> "$RELEASES"
    # Keep the newest bundles (the current one is always among them).
    keep_newest "$APP_BUNDLES/[0-9]*-*" "$KEEP"
    log "Release $RELEASE is live."
    exit 0
  fi
  sleep 2
done
echo "Health check failed. Logs: journalctl -u relayfiles-app -u relayfiles-worker -n 200" >&2
echo "Roll back the app: deploy/scripts/systemd/rollback.sh (bundles: ls $APP_BUNDLES)" >&2
exit 1
