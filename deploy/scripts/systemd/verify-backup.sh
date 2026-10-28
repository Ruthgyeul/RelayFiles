#!/usr/bin/env bash
# Weekly backup check for the systemd deployment (docs/runbook.md "백업 검증"): restores the
# newest dump into a scratch database (VERIFY_DB, default relayfiles_verify, dropped
# afterwards) on the local PostgreSQL, then `npm run backup:verify` compares it with
# production, runs a report-only storage:fsck and stores the result for the Server page.
# One JSON line per run is appended to DATA_DIR/backup-verify.log. Run as root (it creates
# and drops the scratch database as the postgres account); exits 1 when the backup is not usable.
#   sudo deploy/scripts/systemd/verify-backup.sh
set -euo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo $0" >&2; exit 1; }
DATA_DIR="$(env_value DATA_DIR /srv/relayfiles)"
DIR="$DATA_DIR/backups"
LOG="$DATA_DIR/backup-verify.log"
VERIFY_DB="${VERIFY_DB:-relayfiles_verify}"
DB_USER="$(env_value POSTGRES_USER relayfiles)"
DB_HOST="$(env_value POSTGRES_HOST 127.0.0.1)"
DB_PORT="$(env_value POSTGRES_PORT 5432)"
DB_PASSWORD="$(env_value POSTGRES_PASSWORD)"

drop() { sudo -u postgres dropdb --if-exists "$VERIFY_DB"; }
trap drop EXIT

# verify ARGS... → npm run backup:verify as the storage account, reading the scratch URL on stdin.
verify() { "$(dirname "$0")/rf.sh" backup:verify -- "$@" | tee -a "$LOG"; }

DUMP="$(newest_first "$DIR"/relayfiles-*.dump | head -n 1)"
if [ -z "$DUMP" ]; then
  log "No dump in $DIR"
  verify --failure "no database dump in $DIR (deploy/scripts/systemd/backup.sh)" < /dev/null
  exit 1
fi
DUMP_AT="$(date -u -d "@$(stat -c %Y -- "$DUMP")" +%Y-%m-%dT%H:%M:%SZ)"
DUMP_ARGS=(--dump-name "$(basename "$DUMP")" --dump-at "$DUMP_AT")

log "Restoring $(basename "$DUMP") into $VERIFY_DB"
drop
sudo -u postgres createdb -O "$DB_USER" "$VERIFY_DB"
STARTED="$(date +%s%3N)"
if ! PGPASSWORD="$DB_PASSWORD" pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$VERIFY_DB" --no-owner --no-privileges --exit-on-error "$DUMP"; then
  verify "${DUMP_ARGS[@]}" --failure "pg_restore failed for $(basename "$DUMP")" < /dev/null
  exit 1
fi
RESTORE_MS="$(($(date +%s%3N) - STARTED))"

log "Comparing with production and checking storage"
# Percent-encoded for the URL; passed through the environment, not the visible command line.
encode() { VALUE="$1" node -e 'process.stdout.write(encodeURIComponent(process.env.VALUE))'; }
URL_USER="$(encode "$DB_USER")"
URL_PASSWORD="$(encode "$DB_PASSWORD")"
printf 'postgresql://%s:%s@%s:%s/%s' "$URL_USER" "$URL_PASSWORD" "$DB_HOST" "$DB_PORT" "$VERIFY_DB" | verify "${DUMP_ARGS[@]}" --restore-ms "$RESTORE_MS" --restored-url -
