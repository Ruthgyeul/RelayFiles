#!/usr/bin/env bash
# Runs an npm script from this checkout as the storage account, the same way the services
# run, so files it creates on the SSD get the right owner:
#   deploy/scripts/systemd/rf.sh admin:create
#   deploy/scripts/systemd/rf.sh volume:init -- /mnt/relayfilesDB2
set -euo pipefail
source "$(dirname "$0")/../lib.sh"

[ $# -gt 0 ] || { echo "usage: $0 <npm script> [args]" >&2; exit 2; }
cd "$ROOT"
# umask 077 like the services (UMask=0077): files written to the SSD stay private (0600 / 0700).
exec sudo -u "$STORAGE_USER" -H -- sh -c 'umask 077 && exec env npm_config_update_notifier=false npm run --silent "$@"' rf "$@"
