#!/usr/bin/env bash
# One-time setup of the systemd deployment (safe to run again after changing .env or the
# templates). Run from the checkout after `npm ci`:
#   sudo deploy/scripts/systemd/install.sh
# Renders deploy/systemd/*.service.template and deploy/nginx/host/relayfiles.conf.template
# with values from .env, then enables the services. It does not start the app; the first
# deploy/scripts/systemd/release.sh does.
set -euo pipefail
source "$(dirname "$0")/../lib.sh"

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo." >&2; exit 1; }

UNIT_DIR="/etc/systemd/system"
SITE="/etc/nginx/sites-available/relayfiles.conf"
NODE_MAJOR=24
OWNER="$(stat -c %U "$ROOT")"

need() { command -v "$1" > /dev/null || { echo "Missing $1: $2" >&2; exit 1; }; }
need node "install Node.js $NODE_MAJOR (docs/deploy-systemd.md §1)"
need npm "comes with Node.js"
need nginx "apt install nginx"
command -v ffmpeg > /dev/null || echo "Warning: ffmpeg not found; video thumbnails will fail (apt install ffmpeg)." >&2
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge "$NODE_MAJOR" ] || { echo "Node.js $NODE_MAJOR or newer is required." >&2; exit 1; }
[ -d "$ROOT/node_modules" ] || { echo "Run npm ci in $ROOT first (as $OWNER)." >&2; exit 1; }
case "$ROOT" in /home/*|/root/*) echo "Move the checkout out of home directories (e.g. /opt/relayfiles); the services cannot read them." >&2; exit 1 ;; esac

log "Storage account $STORAGE_USER"
UID_="$(env_value STORAGE_UID 10001)"
GID_="$(env_value STORAGE_GID 10001)"
getent group "$STORAGE_USER" > /dev/null || groupadd --system --gid "$GID_" "$STORAGE_USER"
getent passwd "$STORAGE_USER" > /dev/null || useradd --system --uid "$UID_" --gid "$STORAGE_USER" --no-create-home --shell /usr/sbin/nologin "$STORAGE_USER"
install -d -o "$STORAGE_USER" -g "$STORAGE_USER" -m 0700 "$STORAGE_HOME"
usermod -d "$STORAGE_HOME" "$STORAGE_USER"
install -d -o "$STORAGE_USER" -g "$STORAGE_USER" -m 0750 "$(env_value LOG_DIR /var/log/relayfiles)"
install -d -o "$OWNER" -m 0700 "$(env_value DATA_DIR /srv/relayfiles)"
install -d -o "$OWNER" -m 0755 "$APP_BUNDLES"

# The services read .env through the storage group; nobody else may.
chgrp "$STORAGE_USER" "$ENV_FILE"
chmod 0640 "$ENV_FILE"
sudo -u "$STORAGE_USER" test -r "$ROOT/package.json" -a -r "$ENV_FILE" \
  || { echo "$STORAGE_USER cannot read $ROOT (make the checkout world-readable: chmod 755)." >&2; exit 1; }

render() {
  APP_DIR="$ROOT" STORAGE_USER="$STORAGE_USER" STORAGE_HOME="$STORAGE_HOME" NODE_BIN="$(command -v node)" \
    node "$ROOT/scripts/render-template.mjs" "$@"
}

log "systemd units"
for unit in relayfiles-app relayfiles-worker; do
  render "$ROOT/deploy/systemd/$unit.service.template" APP_DIR STORAGE_USER STORAGE_HOME NODE_BIN > "$UNIT_DIR/$unit.service.partial"
  mv "$UNIT_DIR/$unit.service.partial" "$UNIT_DIR/$unit.service"
done
systemctl daemon-reload
systemctl enable relayfiles-app relayfiles-worker

log "Nginx site $SITE"
CERTBOT=false
grep -q "managed by Certbot" "$SITE" 2> /dev/null && CERTBOT=true
render "$ROOT/deploy/nginx/host/relayfiles.conf.template" APP_DIR APP_PORT SERVER_NAME NGINX_LISTEN_PORT > "$SITE.partial"
mv "$SITE.partial" "$SITE"
ln -sfn "$SITE" /etc/nginx/sites-enabled/relayfiles.conf
nginx -t
systemctl reload nginx

log "Done. Next: deploy/scripts/systemd/release.sh (as $OWNER)."
if [ "$CERTBOT" = true ]; then
  echo "The site was re-rendered without Certbot's TLS lines. Restore them with:" >&2
  echo "  sudo certbot install --nginx --cert-name $(env_value SERVER_NAME) --redirect" >&2
fi
