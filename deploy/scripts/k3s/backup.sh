#!/usr/bin/env bash
# PostgreSQL backup for the k3s deployment (pg_dump custom format, run inside the PostgreSQL pod)
# into DATA_DIR/backups on the machine that runs it, keeping the newest BACKUP_KEEP files
# (default 14; lib.sh backup_database). Run it on the storage node, where verify-backup.sh and
# offsite-backup.sh read the dumps, or set BACKUP_DIR. deploy.sh runs it before migrations.
#   deploy/scripts/k3s/backup.sh
set -euo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

command -v kubectl > /dev/null || { echo "kubectl not found (on a k3s server: export KUBECONFIG=/etc/rancher/k3s/k3s.yaml)." >&2; exit 1; }
NS="$(env_value K3S_NAMESPACE relayfiles)"
# The pod's own POSTGRES_USER and POSTGRES_DB (from the relayfiles-env Secret), quoted for its shell.
# shellcheck disable=SC2016
backup_database kubectl -n "$NS" exec statefulset/relayfiles-postgres -- sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'
