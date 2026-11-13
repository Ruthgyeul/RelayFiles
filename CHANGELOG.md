# Changelog

What changed in each release, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). `npm run check:changelog` fails when the version in `package.json` has no section here. Steps an operator has to take for a release are in [docs/upgrade/](docs/upgrade/README.md).

## [Unreleased]

### Added

- Favorites: a folder at the top of the root that lists favorite files and folders where they are, with its own organizing folders, search, tag search, sort, filters and a grid view
- Earlier versions of replaced files are kept and can be downloaded or restored (version history dialog)
- Recently deleted: deleted items can be restored with their share links and settings; the retention is configurable (`TRASH_RETENTION_HOURS`)
- Storage page: what each top folder holds, the largest files and files nobody opened lately
- Shift-click range selection and renaming many items at once
- Shared by me: everything shared from the account, made private one by one or all at once
- Daily traffic limits per share link and per account (`SHARE_DAILY_BYTES_CAP_GB`)
- A choice of how much metadata shared photos and videos lose (`SHARE_METADATA_STRIP`)
- Link activity summary with CSV export, viewer subtitles (`.vtt`/`.srt`) and a slideshow
- WebDAV server (`npm run dav`): read and write with an API token
- Command-line client (`cli/`) and an OpenAPI document for API v1 generated from code
- API v1: rename, move, search, share settings and link reset
- Account export as one tar with a manifest (`storage:import -- --with-metadata` brings it back)
- A personal security log, API token health and warnings about stale tokens
- Admin: usage report per account with CSV export, audit log screen, invite codes with a use count and an expiry date
- Owner notifications through a webhook (generic JSON, ntfy, Discord, Telegram), including share link opens and used-up downloads
- Virus scan (ClamAV) of files received through upload links
- Installable app (web app manifest) with a web share target
- Uploads resume after a page reload, with a warning before leaving
- k3s: media jobs can run on the Pi nodes over NFS (`K3S_MEDIA_REPLICAS`)

### Changed

- Bulk operations, folder views and share pages run a constant number of queries

### Fixed

- Account export lists a tree in the same order every time
- Uploads: one file per batch slot, hidden characters in names are rejected, a resumable upload is no longer counted twice, share links survive a replace, and chunks are dropped when finalizing fails
- Storage writes are serialized with volume moves, layout migrations and fsck
- Viewer: every literal `>` in converted subtitle cues is escaped; a subtitle read is not logged as a view

### Security

- Share links: folder limits are counted inside zips, link ids are hardened, password guesses are budgeted per locked item, and a folder's password and access rules apply down the path
- API tokens are revoked together with the account token; token races are closed
- CSP reports, password guesses, live conversions and zip checks are bounded
- Deployment: the databases are isolated, the app trusts only its proxy, host secrets stay out of the app, and maintenance mode stays on after a failed release

## [1.5.0] - 2026-10-31

The first version recorded here. It holds everything built before this file existed: the file manager with folders, tags and search, resumable uploads (tus), upload-only links, share links with passwords and download limits, the media viewer with thumbnails and on-the-fly video conversion, metadata-stripped copies for public links, admin pages with live server metrics, several storage volumes with moves and `storage:fsck`, the public Status page and personal API tokens.

### Added

- Renumber files by the date a photo or video was taken, and Find duplicates ([upgrade notes](docs/upgrade/folder-tools-transfers.md))

### Fixed

- The search and account buttons' accessible names match their text
