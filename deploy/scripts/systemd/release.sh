#!/usr/bin/env bash
# Releases the checked-out version on the systemd deployment: backup → npm ci → build →
# copy the bundle to .app/<release> → maintenance on → migrate (schema, data, storage
# layout) → switch .app/current → restart → health check (status ok) → maintenance off.
# Run on the server from the checkout, as the user who owns it:
#   git pull && deploy/scripts/systemd/release.sh
# The running app keeps serving from its own bundle while the new one builds. Once maintenance is
# on, only a healthy release lifts it: when a migration or the health check fails, visitors keep
# seeing the maintenance page and the script prints what to do next (rollback.sh,
# docs/deploy-systemd.md "단계별로 실패했을 때").
set -euo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
RELEASE="$(date -u +%Y%m%d%H%M%S)-$SHA"
FLAG="$ROOT/deploy/maintenance/on"
PORT="$(env_value APP_PORT 3000)"
KEEP="${BUNDLE_KEEP:-3}"
RELEASES="$(env_value DATA_DIR /srv/relayfiles)/releases.log"
RF="$ROOT/deploy/scripts/systemd/rf.sh"

# Which step is running: on a failure, the exit trap tells what changed and how to go on.
STAGE=prepare
on_exit() {
  local status=$?
  [ "$status" -eq 0 ] && return
  case "$STAGE" in
    prepare) echo "Release $RELEASE stopped before anything changed; the previous bundle is still serving." >&2 ;;
    migrate)
      cat >&2 << EOF

Migrations of $RELEASE failed. Maintenance mode stays on (visitors see the 503 page); the
previous bundle still runs, and the schema may be partly migrated.
  Status:  deploy/scripts/systemd/rf.sh db:deploy (its output), npx prisma migrate status
  Then:    fix the cause and run deploy/scripts/systemd/release.sh again (data and storage migrations resume),
           or reopen the previous release unchanged: rm deploy/maintenance/on
EOF
      ;;
    restart)
      cat >&2 << EOF

Release $RELEASE did not become healthy. Maintenance mode stays on (visitors see the 503 page).
  Logs:      journalctl -u relayfiles-app -u relayfiles-worker -n 200
  Health:    curl -fsS http://127.0.0.1:$PORT/api/health
  Roll back: deploy/scripts/systemd/rollback.sh   (the previous bundle; it lifts maintenance once healthy)
  Or fix and run deploy/scripts/systemd/release.sh again.
EOF
      ;;
  esac
}
trap on_exit EXIT

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

# Visitors see the static maintenance page while the schema changes.
STAGE=migrate
touch "$FLAG"

log "Migrations (schema, data, storage layout)"
"$RF" db:deploy
"$RF" data:migrate
"$RF" storage:migrate

STAGE=restart
log "Switch to $RELEASE and restart"
ln -sfn "$RELEASE" "$APP_BUNDLES/current.next"
mv -T "$APP_BUNDLES/current.next" "$APP_BUNDLES/current"
sudo systemctl restart relayfiles-app relayfiles-worker

# Checked on the app port, past Nginx: visitors come back only once it says "ok".
log "Health check"
wait_healthy "http://127.0.0.1:$PORT/api/health"
rm -f "$FLAG"
STAGE=live
echo "$(date -u +%FT%TZ) $RELEASE" >> "$RELEASES"
# Keep the newest bundles (the current one is always among them).
keep_newest "$KEEP" "$APP_BUNDLES"/[0-9]*-*
log "Release $RELEASE is live."
