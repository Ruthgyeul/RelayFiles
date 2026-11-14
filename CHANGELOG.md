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

- Dialogs keep focus in the field being typed in while the page updates (an upload in progress moved it to Close), return focus to the button that opened them, and Escape closes only the top dialog
- An open item menu keeps keyboard focus while the page updates
- The navigation drawer and bottom sheets keep keyboard focus inside while open, give it back to their button when closed, and take Escape only when they are on top
- The Delete key deletes the selected items, as the shortcuts list says
- The failed-upload toast gives the right count
- Items with names close to the 255-byte limit can be deleted
- Moving or copying a folder tree under a deep folder is refused instead of leaving items that answer 500
- A copy or restore of a file still waiting for its virus scan is scanned and no longer stays "Scanning" forever
- The ClamAV client no longer crashes or blocks the worker when clamd drops the connection mid-file
- A counted share download is kept when its resume grant cannot be stored (a delete-after-download file was used up without being received)
- The daily cleanup goes on with the other volumes when one fails; an alert that could not be queued no longer holds back the next one
- Zips leave out files missing from the disk and list them in "Not included.txt" (such a zip used to hang); "Download all" of a busy share link is slowed down like single downloads
- Several uploads of one name into one folder that finish together are all kept ("name (2)", …) instead of failing with a 500 and losing the bytes
- An upload whose batch, link or token is gone by the time it finishes gives its reserved space and received bytes back at once, not after `UPLOAD_TMP_TTL_HOURS`
- WebDAV COPY or MOVE with Overwrite no longer deletes the destination when the copy is then refused (quota, item limit, busy volume): the new item is put in place first
- Link activity of a folder with more than about 65,000 items inside no longer fails with a 500
- Video conversion slots are timed by Redis's clock, so k3s nodes whose clocks drift no longer stop each other's conversions
- Moving favorites answers 404 for another account's items
- An upload-only link's size limit is bounded (a huge value gave a 500)
- Security log "Load more" no longer appends an old page after a reload
- The CLI keeps downloads in the current folder and stops an upload whose file changes while it is read
- Account export lists a tree in the same order every time
- Uploads: one file per batch slot, hidden characters in names are rejected, a resumable upload is no longer counted twice, share links survive a replace, and chunks are dropped when finalizing fails
- Storage writes are serialized with volume moves, layout migrations and fsck
- Viewer: every literal `>` in converted subtitle cues is escaped; a subtitle read is not logged as a view

### Security

- A folder's daily traffic limit also covers the links of files and folders inside it (another link no longer gets around it), and a private link that expired or ran out looks like a missing link to visitors
- WebDAV requests are rate limited per address in Nginx (`NGINX_DAV_RATE_PER_MIN`, `NGINX_DAV_BURST`) before the token check
- IPv4 addresses written in IPv6 form (`::ffff:a.b.c.d`) are masked like other IPv4 addresses
- Log redaction drops values nested too deep to check instead of logging them
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
