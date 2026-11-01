# RelayFiles

Fast and easy file sharing system. A private file drop for sharing and streaming media from a self-hosted server: upload, get a link, and limit it to a set number of downloads (admins can also make it expire on a date or after the first download).

## Stack

Next.js 16.4 (App Router) · React 19.3 · Tailwind CSS 4.3 · TypeScript 6 · PostgreSQL 16 + Prisma · Redis 7 + BullMQ · Vitest · Playwright

## Getting started

```bash
nvm use            # Node.js 24
npm ci
cp .env.example .env   # then fill in values
npm run env:secrets    # prints random secrets to paste into .env
npm run env:check      # validates .env
docker compose --env-file .env -f deploy/docker-compose.dev.yml up -d   # PostgreSQL + Redis
npm run db:deploy      # apply database migrations
npm run volume:init    # prepare the storage folder (STORAGE_ROOT)
npm run admin:create   # first admin account (prints its token once)
npm run dev            # http://localhost:3000
npm run worker         # thumbnails, previews, cleanup (needs ffmpeg)
```

## Scripts

Every npm script (development, checks, storage, volumes, keys) is listed with what it does in [CLAUDE.md "명령어"](CLAUDE.md#명령어). Before a change goes in, `npm run check` must pass (and `npm run test:integration` when it touches the database or storage).

## Documentation

- [Deployment (Docker)](docs/deploy-ubuntu.md) · [Deployment (systemd)](docs/deploy-systemd.md) · [Deployment (k3s)](docs/deploy-k3s.md) · [Runbook](docs/runbook.md)
- [Architecture](docs/architecture.md) · [Security](docs/security.md) · [API](docs/api.md)
- [Design spec](docs/design/spec.md)
- [Project rules for contributors and agents](CLAUDE.md)
