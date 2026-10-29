#!/usr/bin/env bash
# Deploys a release published to GHCR (.github/workflows/images.yml) to k3s
# (docs/deploy-k3s.md): .env becomes the relayfiles-env Secret, the Nginx templates and error
# pages become ConfigMaps, then PostgreSQL and Redis → migrations (a Job with the new tools
# image) → app, worker and Nginx, all on the node labelled relayfiles/storage=true. Run from a
# repository checkout (npm ci done) with kubectl access to the cluster:
#   deploy/scripts/k3s/deploy.sh [sha-<12 hex> | vX.Y.Z]   (default: this checkout's commit)
# Rollback: the same command with an earlier tag (schema changes are expand → contract, so the
# previous release runs on the newer schema).
set -euo pipefail
# shellcheck source=../lib.sh
source "$(dirname "$0")/../lib.sh"

command -v kubectl > /dev/null || { echo "kubectl not found (on a k3s server: export KUBECONFIG=/etc/rancher/k3s/k3s.yaml)." >&2; exit 1; }
TAG="${1:-sha-$(git -C "$ROOT" rev-parse --short=12 HEAD)}"
REPO="$(env_value K3S_IMAGE_REPO)"
[ -n "$REPO" ] || { echo "Set K3S_IMAGE_REPO in .env (e.g. ghcr.io/<owner>/relayfiles)." >&2; exit 1; }
NS="$(env_value K3S_NAMESPACE relayfiles)"
TIMEOUT="${K3S_TIMEOUT:-30m}"

NODES="$(kubectl get nodes -l relayfiles/storage=true -o name | wc -l)"
[ "$NODES" = 1 ] || { echo "Label the node with the storage SSD, and only it: kubectl label node <node> relayfiles/storage=true (labelled now: $NODES)." >&2; exit 1; }

# Values the templates need, with the defaults of src/config/env.ts; images as compose pins them.
export K3S_NAMESPACE="$NS" APP_IMAGE="$REPO-app:$TAG" TOOLS_IMAGE="$REPO-tools:$TAG"
export RELEASE_ID="${TAG//[^a-zA-Z0-9]/-}"
RELEASE_ID="${RELEASE_ID,,}"
POSTGRES_IMAGE="$(compose_image postgres)" REDIS_IMAGE="$(compose_image redis)" NGINX_IMAGE="$(compose_image nginx)"
export POSTGRES_IMAGE REDIS_IMAGE NGINX_IMAGE
NGINX_RESOLVER="$(kubectl -n kube-system get service kube-dns -o jsonpath='{.spec.clusterIP}')"
export NGINX_RESOLVER
for pair in K3S_APP_REPLICAS:1 APP_PORT:3000 STORAGE_UID:10001 STORAGE_GID:10001 DATA_DIR:/srv/relayfiles LOG_DIR:/var/log/relayfiles \
  APP_MEMORY_MAX:2G APP_CPUS:3 WORKER_MEMORY_MAX:2G WORKER_CPUS:2 NGINX_LISTEN_PORT:80 SERVER_NAME:localhost STORAGE_ACCEL_PREFIX:/_protected/ \
  NGINX_MAX_BODY_MB:100 NGINX_AUTH_RATE_PER_MIN:20 NGINX_AUTH_BURST:20 NGINX_UPLOAD_RATE_PER_MIN:60 NGINX_UPLOAD_BURST:30 STORAGE_ROOT:; do
  export "${pair%%:*}=$(env_value "${pair%%:*}" "${pair#*:}")"
done
[[ "$STORAGE_ROOT" == /* ]] || { echo "STORAGE_ROOT must be an absolute path on the storage node." >&2; exit 1; }
KEYS=(K3S_NAMESPACE APP_IMAGE TOOLS_IMAGE RELEASE_ID POSTGRES_IMAGE REDIS_IMAGE NGINX_IMAGE NGINX_RESOLVER K3S_APP_REPLICAS APP_PORT STORAGE_UID STORAGE_GID DATA_DIR LOG_DIR
  APP_MEMORY_MAX APP_CPUS WORKER_MEMORY_MAX WORKER_CPUS NGINX_LISTEN_PORT SERVER_NAME STORAGE_ACCEL_PREFIX NGINX_MAX_BODY_MB NGINX_AUTH_RATE_PER_MIN NGINX_AUTH_BURST
  NGINX_UPLOAD_RATE_PER_MIN NGINX_UPLOAD_BURST STORAGE_ROOT)
render() { node "$ROOT/scripts/render-template.mjs" "$ROOT/deploy/k3s/$1.yaml.template" "${KEYS[@]}"; }
apply() { kubectl apply -f - > /dev/null; }

log "Release $TAG to namespace $NS"
kubectl create namespace "$NS" --dry-run=client -o yaml | apply
kubectl -n "$NS" create secret generic relayfiles-env --from-env-file="$ENV_FILE" --dry-run=client -o yaml | apply
for map in relayfiles-nginx-templates:deploy/nginx/templates relayfiles-error-pages:deploy/error-pages relayfiles-nginx-volumes:deploy/nginx/volumes; do
  kubectl -n "$NS" create configmap "${map%%:*}" --from-file="$ROOT/${map#*:}" --dry-run=client -o yaml | apply
done

log "PostgreSQL and Redis"
render data | apply
for name in statefulset/relayfiles-postgres statefulset/relayfiles-redis; do kubectl -n "$NS" rollout status "$name" --timeout="$TIMEOUT"; done

log "Migrations (schema, data, storage layout) with $TOOLS_IMAGE"
JOB="job/relayfiles-migrate-$RELEASE_ID"
kubectl -n "$NS" delete "$JOB" --ignore-not-found > /dev/null
render migrate-job | apply
if ! kubectl -n "$NS" wait --for=condition=complete "$JOB" --timeout="$TIMEOUT"; then
  kubectl -n "$NS" logs "$JOB" >&2 || true
  echo "Migrations failed; the running release is unchanged." >&2
  exit 1
fi

log "App, worker and Nginx"
render relayfiles | apply
for name in deployment/relayfiles-app deployment/relayfiles-worker deployment/relayfiles-nginx; do kubectl -n "$NS" rollout status "$name" --timeout="$TIMEOUT"; done

# Readiness only needs an answer; a release is live once /api/health says "ok".
log "Health check"
HEALTH="$(kubectl -n "$NS" exec deployment/relayfiles-app -- node -e "fetch('http://127.0.0.1:$APP_PORT/api/health').then((r) => r.text()).then(console.log)")"
if status_ok "$HEALTH"; then
  log "Release $TAG is live."
else
  echo "Health check failed: $HEALTH" >&2
  echo "Roll back: deploy/scripts/k3s/deploy.sh <previous tag> (kubectl -n $NS logs deployment/relayfiles-app)" >&2
  exit 1
fi
