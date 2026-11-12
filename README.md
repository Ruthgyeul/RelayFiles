# RelayFiles

Fast and easy file sharing system. A private file drop for sharing and streaming media from a self-hosted server: upload, get a link, and limit it to a set number of downloads (admins can also make it expire on a date or after the first download).

## Features

- File Manager with folders, tags, search, move and copy, "Renumber files" and "Find duplicates"
- Earlier versions of replaced files are kept for `FILE_VERSIONS_DAYS` (7 by default) and can be downloaded or restored
- Daily traffic limits per share link and per account (`SHARE_DAILY_BYTES_CAP_GB`)
- A Storage page: what each top folder holds, the largest files, old files nobody opened through a share link, and the trash
- Shift-click to select a range, and rename many items at once (find and replace, prefix and suffix with numbers, letter case) with every new name checked first
- Favorites: a folder at the top of the root that lists favorite files and folders where they are (no copies), with its own organizing folders
- Resumable uploads (tus) that continue after a page reload, and upload-only links (file requests)
- Share links per file or folder: password, download limit, stream only; admins can also set expiry and delete after the first download
- Link activity per item: opens, views, plays and downloads with 7- and 30-day counts, exportable as CSV
- Media viewer for pictures (with a slideshow), video (on-the-fly conversion, `.vtt`/`.srt` subtitles from the same folder), audio and documents (text, code, Markdown, tables, PDF, Word, Excel), with thumbnails and copies for public links without location and personal metadata (photos and videos; how much goes is `SHARE_METADATA_STRIP`, the date taken stays by default)
- Recently deleted: deleted items can be restored with their share links and settings for `TRASH_RETENTION_HOURS` (24 by default, up to 30 days)
- Admin pages: accounts, live server metrics, sign-up mode, theme, announcements and an audit log of admin actions
- An admin usage report: storage, trash and share traffic per account over 30 days to 12 months, with a CSV export
- Several storage volumes with volume moves, layout migrations and `storage:fsck`; a public Status page
- Personal API tokens for scripts (`/api/v1`)
- A personal security log: sign-ins, sign-outs, token changes and refused API tokens of your own account
- Installable app (web app manifest) that appears in the phone's share sheet: files shared from another app go to a new Home folder after one tap (Web Share Target through a minimal service worker that caches nothing)
- Owner notifications through a webhook (generic JSON, ntfy, Discord, Telegram): files received through an upload-only link, a storage volume low, offline or not writable, a failed backup check, and (per account, opt-in) share links opened or their downloads used up

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
