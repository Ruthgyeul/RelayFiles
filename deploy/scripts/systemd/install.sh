#!/usr/bin/env bash
# One-time setup of the systemd deployment (safe to run again after changing .env or the
# templates). Run from the checkout after `npm ci`:
#   sudo deploy/scripts/systemd/install.sh
# Renders deploy/systemd/*.service.template and deploy/nginx/host/*.conf.template with values
# from .env, then enables the services. It does not start the app; the first
# deploy/scripts/systemd/release.sh does.
set -euo pipefail
# shellcheck source=../lib.sh
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

# Cores as a CPUQuota percentage: 1.5 -> 150%.
cpu_quota() { awk -v cpus="$1" 'BEGIN { printf "%d%%", cpus * 100 }'; }
# unit, memory limit, CPU cores, stop grace period in seconds (defaults as in src/config/env.ts)
render_unit() {
  MEMORY_MAX="$2" CPU_QUOTA="$(cpu_quota "$3")" STOP_GRACE_SEC="$4" STORAGE_ROOT="$(env_value STORAGE_ROOT /mnt/relayfilesDB)" LOG_DIR="$(env_value LOG_DIR /var/log/relayfiles)" \
    render "$ROOT/deploy/systemd/$1.service.template" APP_DIR STORAGE_USER STORAGE_HOME NODE_BIN MEMORY_MAX CPU_QUOTA STOP_GRACE_SEC STORAGE_ROOT LOG_DIR > "$UNIT_DIR/$1.service.partial"
  mv "$UNIT_DIR/$1.service.partial" "$UNIT_DIR/$1.service"
}

log "systemd units"
render_unit relayfiles-app "$(env_value APP_MEMORY_MAX 2G)" "$(env_value APP_CPUS 3)" "$(env_value APP_STOP_GRACE_SEC 30)"
render_unit relayfiles-worker "$(env_value WORKER_MEMORY_MAX 2G)" "$(env_value WORKER_CPUS 2)" "$(env_value WORKER_STOP_GRACE_SEC 90)"
systemctl daemon-reload
systemctl enable relayfiles-app relayfiles-worker

log "Nginx site $SITE"
CERTBOT=false
grep -q "managed by Certbot" "$SITE" 2> /dev/null && CERTBOT=true
# Request limits default as in src/config/policy.ts NGINX.
NGINX_MAX_BODY_MB="$(env_value NGINX_MAX_BODY_MB 100)" NGINX_AUTH_RATE_PER_MIN="$(env_value NGINX_AUTH_RATE_PER_MIN 20)" NGINX_AUTH_BURST="$(env_value NGINX_AUTH_BURST 20)" \
  NGINX_UPLOAD_RATE_PER_MIN="$(env_value NGINX_UPLOAD_RATE_PER_MIN 60)" NGINX_UPLOAD_BURST="$(env_value NGINX_UPLOAD_BURST 30)" \
  NGINX_API_RATE_PER_MIN="$(env_value NGINX_API_RATE_PER_MIN 120)" NGINX_API_BURST="$(env_value NGINX_API_BURST 60)" \
  render "$ROOT/deploy/nginx/host/relayfiles.conf.template" APP_DIR APP_PORT SERVER_NAME NGINX_LISTEN_PORT NGINX_MAX_BODY_MB \
  NGINX_AUTH_RATE_PER_MIN NGINX_AUTH_BURST NGINX_UPLOAD_RATE_PER_MIN NGINX_UPLOAD_BURST NGINX_API_RATE_PER_MIN NGINX_API_BURST > "$SITE.partial"
mv "$SITE.partial" "$SITE"
ln -sfn "$SITE" /etc/nginx/sites-enabled/relayfiles.conf

# Unknown Host names: closed by relayfiles-catchall.conf (444), unless SERVER_NAME=_ (this site is
# then meant to answer every name) or another enabled site is already the port's default server
# (two would fail nginx -t; Ubuntu's stock "default" site is one and shows its welcome page).
CATCHALL="/etc/nginx/sites-available/relayfiles-catchall.conf"
CATCHALL_LINK="/etc/nginx/sites-enabled/relayfiles-catchall.conf"
LISTEN_PORT="$(env_value NGINX_LISTEN_PORT 80)"
rm -f "$CATCHALL_LINK"
OTHER_DEFAULT="$(grep -lsE "^[[:space:]]*listen[[:space:]]+([^;]*:)?$LISTEN_PORT([[:space:]][^;]*)?[[:space:]]default_server" /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf | head -n 1 || true)"
if [ "$(env_value SERVER_NAME)" = "_" ]; then
  echo "SERVER_NAME=_: requests for any host name reach RelayFiles (no catch-all installed)." >&2
elif [ -n "$OTHER_DEFAULT" ]; then
  echo "Unknown host names on port $LISTEN_PORT go to $OTHER_DEFAULT (its default_server), not to RelayFiles." >&2
  echo "  To close them instead: remove that site (e.g. sudo rm /etc/nginx/sites-enabled/default) and run install.sh again." >&2
else
  NGINX_LISTEN_PORT="$LISTEN_PORT" render "$ROOT/deploy/nginx/host/relayfiles-catchall.conf.template" NGINX_LISTEN_PORT > "$CATCHALL.partial"
  mv "$CATCHALL.partial" "$CATCHALL"
  ln -sfn "$CATCHALL" "$CATCHALL_LINK"
fi
nginx -t
systemctl reload nginx

log "Done. Next: deploy/scripts/systemd/release.sh (as $OWNER)."
if [ "$CERTBOT" = true ]; then
  echo "The site was re-rendered without Certbot's TLS lines. Restore them with:" >&2
  echo "  sudo certbot install --nginx --cert-name $(env_value SERVER_NAME) --redirect" >&2
fi
