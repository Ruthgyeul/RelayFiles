# RelayFiles

Fast and easy file sharing system. A private file drop for sharing and streaming media from a self-hosted server: upload, get a link, and let it expire on a date or after a set number of downloads.

> Status: **M0–M16 implemented**, running in production. Design decisions: [`docs/plan.md`](docs/plan.md).

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

| Command | Description |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build (standalone bundle) |
| `npm run start` | Run the standalone server |
| `npm run check` | Typecheck, lint, emoji check, migration check, unit tests and build |
| `npm run test:integration` | Integration tests against PostgreSQL and Redis |
| `npm run test:e2e` | Playwright E2E at 360 / 768 / 1280 px |
| `npm run env:check` | Validate `.env` without starting the app |
| `npm run env:secrets` | Print freshly generated secrets for `.env` |

## Documentation

- [Design decisions](docs/plan.md)
- [Deployment (Docker)](docs/deploy-ubuntu.md) · [Deployment (systemd)](docs/deploy-systemd.md) · [Runbook](docs/runbook.md)
- [Architecture](docs/architecture.md)
- [Design spec](docs/design/spec.md)
- [Project rules for contributors and agents](CLAUDE.md)
