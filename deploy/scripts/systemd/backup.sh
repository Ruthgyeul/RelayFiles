#!/usr/bin/env bash
# PostgreSQL backup for the systemd deployment (pg_dump custom format) into
# DATA_DIR/backups, keeping the newest BACKUP_KEEP files (default 14; lib.sh backup_database).
#   deploy/scripts/systemd/backup.sh
set -euo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

PGPASSWORD="$(env_value POSTGRES_PASSWORD)"
export PGPASSWORD
backup_database pg_dump \
  -h "$(env_value POSTGRES_HOST 127.0.0.1)" -p "$(env_value POSTGRES_PORT 5432)" \
  -U "$(env_value POSTGRES_USER relayfiles)" -d "$(env_value POSTGRES_DB relayfiles)" -Fc
