#!/usr/bin/env bash
# PostgreSQL backup (pg_dump custom format) into DATA_DIR/backups, keeping the newest
# BACKUP_KEEP files (default 14; lib.sh backup_database). Files on the SSD are backed up
# separately (rsync, see docs/runbook.md); Redis holds only data that can be rebuilt.
#   deploy/scripts/backup.sh
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

backup_database "${COMPOSE[@]}" exec -T postgres pg_dump -U "$(env_value POSTGRES_USER relayfiles)" -d "$(env_value POSTGRES_DB relayfiles)" -Fc
