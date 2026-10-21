#!/usr/bin/env bash
# PostgreSQL backup (pg_dump custom format) into DATA_DIR/backups, keeping the newest
# BACKUP_KEEP files (default 14). Files on the SSD are backed up separately (rsync, see
# docs/runbook.md); Redis holds only data that can be rebuilt.
#   deploy/scripts/backup.sh
set -euo pipefail
source "$(dirname "$0")/lib.sh"

KEEP="${BACKUP_KEEP:-14}"
DIR="$(env_value DATA_DIR /srv/relayfiles)/backups"
mkdir -p "$DIR"
chmod 700 "$DIR"

FILE="$DIR/relayfiles-$(date -u +%Y%m%d-%H%M%S).dump"
log "Backing up the database to $FILE"
"${COMPOSE[@]}" exec -T postgres pg_dump -U "$(env_value POSTGRES_USER relayfiles)" -d "$(env_value POSTGRES_DB relayfiles)" -Fc > "$FILE.partial"
mv "$FILE.partial" "$FILE"
chmod 600 "$FILE"

keep_newest "$DIR/relayfiles-*.dump" "$KEEP"
log "Backup done ($(du -h "$FILE" | cut -f1))."
