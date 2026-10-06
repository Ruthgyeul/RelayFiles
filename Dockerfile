# syntax=docker/dockerfile:1
#
# RelayFiles images (docs/deploy-ubuntu.md):
#   app   - the Next.js standalone server (no build tools, no dev dependencies)
#   tools - worker, database migrations and admin scripts (npm run worker / db:deploy / admin:create)
# Both run as the storage account (STORAGE_UID:STORAGE_GID) that owns /mnt/relayfilesDB.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# All dependencies; postinstall generates the Prisma client from the schema.
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
COPY src/config ./src/config
# Behind a TLS-inspecting proxy, pass its CA: docker build --secret id=extra_ca,src=/path/ca.crt
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi \
 && npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
# Offline build: fonts and every other asset come from node_modules.
RUN npm run build

FROM base AS app
ARG STORAGE_UID=10001
ARG STORAGE_GID=10001
# smartctl for the Server page's Disk health (needs the disk passed into the container).
ARG APP_PACKAGES="smartmontools"
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
RUN groupadd --system --gid ${STORAGE_GID} relayfiles \
 && useradd --system --uid ${STORAGE_UID} --gid relayfiles --no-create-home relayfiles \
 && if [ -n "${APP_PACKAGES}" ]; then apt-get update && apt-get install -y --no-install-recommends ${APP_PACKAGES} && rm -rf /var/lib/apt/lists/*; fi
COPY --from=build --chown=relayfiles:relayfiles /app/.next/standalone ./
COPY --chmod=0755 deploy/docker-entrypoint.sh /usr/local/bin/relayfiles-entrypoint
USER relayfiles
ENTRYPOINT ["relayfiles-entrypoint"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',{method:'HEAD'}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]

FROM deps AS tools
ARG STORAGE_UID=10001
ARG STORAGE_GID=10001
# ffmpeg for video thumbnails.
ARG TOOLS_PACKAGES="ffmpeg"
ENV NODE_ENV=production
RUN groupadd --system --gid ${STORAGE_GID} relayfiles \
 && useradd --system --uid ${STORAGE_UID} --gid relayfiles --no-create-home relayfiles \
 && if [ -n "${TOOLS_PACKAGES}" ]; then apt-get update && apt-get install -y --no-install-recommends ${TOOLS_PACKAGES} && rm -rf /var/lib/apt/lists/*; fi
COPY --chown=relayfiles:relayfiles . .
COPY --chmod=0755 deploy/docker-entrypoint.sh /usr/local/bin/relayfiles-entrypoint
USER relayfiles
ENTRYPOINT ["relayfiles-entrypoint"]
CMD ["npm", "run", "worker"]
