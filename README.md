# RelayFiles

Fast and easy file sharing system. A private file drop for sharing and streaming media from a self-hosted server: upload, get a link, and let it expire on a date or after a set number of downloads.

> Status: **M0 (project setup)**. The UI and backend are built milestone by milestone — see [`docs/plan.md`](docs/plan.md).

## Stack

Next.js 16.3 (App Router) · React 19.3 · Tailwind CSS 4.3 · TypeScript 6 · PostgreSQL 16 + Prisma · Redis 7 + BullMQ · Vitest · Playwright

## Getting started

```bash
nvm use            # Node.js 24
npm ci
cp .env.example .env.local
npm run dev        # http://localhost:3000
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build (standalone bundle) |
| `npm run start` | Run the standalone server |
| `npm run check` | Typecheck, lint, emoji check, unit tests and build |
| `npm run test:e2e` | Playwright E2E at 360 / 768 / 1280 px |

## Documentation

- [Implementation plan](docs/plan.md)
- [Architecture](docs/architecture.md)
- [Design prototype](docs/design/Relay_App.dc.html)
- [Project rules for contributors and agents](CLAUDE.md)
