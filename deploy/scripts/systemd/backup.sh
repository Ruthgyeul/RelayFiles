#!/usr/bin/env bash
# PostgreSQL backup for the systemd deployment (pg_dump custom format) into
# DATA_DIR/backups, keeping the newest BACKUP_KEEP files (default 14).
#   deploy/scripts/systemd/backup.sh
set -euo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

KEEP="${BACKUP_KEEP:-14}"
DIR="$(env_value DATA_DIR /srv/relayfiles)/backups"
mkdir -p "$DIR"
chmod 700 "$DIR"

FILE="$DIR/relayfiles-$(date -u +%Y%m%d-%H%M%S).dump"
log "Backing up the database to $FILE"
PGPASSWORD="$(env_value POSTGRES_PASSWORD)" pg_dump \
  -h "$(env_value POSTGRES_HOST 127.0.0.1)" -p "$(env_value POSTGRES_PORT 5432)" \
  -U "$(env_value POSTGRES_USER relayfiles)" -d "$(env_value POSTGRES_DB relayfiles)" \
  -Fc > "$FILE.partial"
mv "$FILE.partial" "$FILE"
chmod 600 "$FILE"

keep_newest "$KEEP" "$DIR"/relayfiles-*.dump
log "Backup done ($(du -h "$FILE" | cut -f1))."
