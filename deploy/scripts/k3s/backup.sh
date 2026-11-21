#!/usr/bin/env bash
# PostgreSQL backup for the k3s deployment (pg_dump custom format, run inside the PostgreSQL pod)
# into DATA_DIR/backups, keeping the newest BACKUP_KEEP files (default 14; lib.sh
# backup_database). kubectl sends the dump to the machine that runs this, so it refuses to run
# anywhere but the storage node (relayfiles/storage=true), where verify-backup.sh and
# offsite-backup.sh read DATA_DIR/backups, unless BACKUP_DIR names the folder to use instead.
# deploy.sh runs it before migrations.
#   deploy/scripts/k3s/backup.sh
set -euo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

command -v kubectl > /dev/null || { echo "kubectl not found (on a k3s server: export KUBECONFIG=/etc/rancher/k3s/k3s.yaml)." >&2; exit 1; }
NS="$(env_value K3S_NAMESPACE relayfiles)"

if [ -z "${BACKUP_DIR:-}" ]; then
  STORAGE_NODE="$(kubectl get nodes -l relayfiles/storage=true -o jsonpath='{.items[0].metadata.name}')"
  HERE="$(hostname)"
  # A k3s node name is the host name, short or full.
  if [ "${STORAGE_NODE,,}" != "${HERE,,}" ] && [ "${STORAGE_NODE,,}" != "${HERE%%.*}" ]; then
    echo "Run this on the storage node ($STORAGE_NODE), where the dumps belong, or set BACKUP_DIR=<folder> to keep them here ($HERE)." >&2
    exit 1
  fi
fi
# The pod's own POSTGRES_USER and POSTGRES_DB (from the relayfiles-env Secret), quoted for its shell.
# shellcheck disable=SC2016
backup_database kubectl -n "$NS" exec statefulset/relayfiles-postgres -- sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc'
