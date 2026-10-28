# syntax=docker/dockerfile:1
#
# RelayFiles images (docs/deploy-ubuntu.md):
#   app   - the Next.js standalone server (no build tools, no dev dependencies)
#   tools - worker, database migrations and admin scripts (npm run worker / db:deploy / admin:create)
# Both run as the storage account (STORAGE_UID:STORAGE_GID) that owns /mnt/relayfilesDB, under
# tini as PID 1 (reaps orphaned processes, forwards stop signals) in Compose, k3s or docker run.

# Debian 13 (trixie): ffmpeg 7.1 instead of bookworm's 5.1 (demuxers are where ffmpeg CVEs land).
# Pinned by digest (the tag alone can be re-pointed); Dependabot proposes the new digest.
ARG NODE_IMAGE=node:24-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea

FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# Prisma picks its schema engine by the OpenSSL it finds: without it npm ci fetches the 1.1.x
# engine, and the tools image (OpenSSL 3 via ffmpeg) then tries to download another at run time.
# tini (Debian package, amd64 and arm64) is PID 1 of both images: Node does not reap orphaned
# processes it did not start itself, so without an init they pile up as zombies.
RUN apt-get update && apt-get install -y --no-install-recommends openssl tini && rm -rf /var/lib/apt/lists/*

# All dependencies; postinstall generates the Prisma client from the schema.
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
COPY src/config ./src/config
# Behind a TLS-inspecting proxy, pass its CA: docker build --secret id=extra_ca,src=/path/ca.crt
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi \
 && npm ci --no-audit --no-fund

# Runtime dependencies only (no vitest, playwright, eslint, jsdom) for the tools image. tsx and
# prisma are dependencies because the worker and migrations run them in production.
FROM base AS prod-deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
COPY src/config ./src/config
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi \
 && npm ci --omit=dev --no-audit --no-fund

FROM deps AS build
COPY . .
# Offline build: fonts and every other asset come from node_modules.
RUN npm run build

FROM base AS app
ARG STORAGE_UID=10001
ARG STORAGE_GID=10001
# smartctl for the Server page's Disk health (needs the disk passed into the container);
# ffmpeg converts videos browsers cannot play while they stream (VIDEO_TRANSCODE_MAX).
ARG APP_PACKAGES="smartmontools ffmpeg"
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
RUN groupadd --system --gid ${STORAGE_GID} relayfiles \
 && useradd --system --uid ${STORAGE_UID} --gid relayfiles --no-create-home relayfiles \
 && if [ -n "${APP_PACKAGES}" ]; then apt-get update && apt-get install -y --no-install-recommends ${APP_PACKAGES} && rm -rf /var/lib/apt/lists/*; fi
COPY --from=build --chown=relayfiles:relayfiles /app/.next/standalone ./
COPY --chmod=0755 deploy/docker-entrypoint.sh /usr/local/bin/relayfiles-entrypoint
COPY --chmod=0644 deploy/healthcheck.mjs /usr/local/lib/relayfiles/healthcheck.mjs
USER relayfiles
ENTRYPOINT ["/usr/bin/tini", "--", "relayfiles-entrypoint"]
EXPOSE 3000
# Exec form (no `sh -c`): with a shell in between, a check Docker stops at --timeout would kill
# only the shell and leave its node child to the container's PID 1.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "/usr/local/lib/relayfiles/healthcheck.mjs"]
CMD ["node", "server.js"]

FROM prod-deps AS tools
ARG STORAGE_UID=10001
ARG STORAGE_GID=10001
# ffmpeg for video thumbnails.
ARG TOOLS_PACKAGES="ffmpeg"
# The container's filesystem is read-only (compose): npm writes its cache and logs to the /tmp tmpfs.
ENV NODE_ENV=production NPM_CONFIG_CACHE=/tmp/.npm
RUN groupadd --system --gid ${STORAGE_GID} relayfiles \
 && useradd --system --uid ${STORAGE_UID} --gid relayfiles --no-create-home relayfiles \
 && if [ -n "${TOOLS_PACKAGES}" ]; then apt-get update && apt-get install -y --no-install-recommends ${TOOLS_PACKAGES} && rm -rf /var/lib/apt/lists/*; fi
COPY --chown=relayfiles:relayfiles . .
COPY --chmod=0755 deploy/docker-entrypoint.sh /usr/local/bin/relayfiles-entrypoint
USER relayfiles
ENTRYPOINT ["/usr/bin/tini", "--", "relayfiles-entrypoint"]
# One Node process for the worker (npm and the tsx launcher would each add another).
CMD ["node", "--import", "tsx", "--conditions=react-server", "scripts/worker.mts"]
