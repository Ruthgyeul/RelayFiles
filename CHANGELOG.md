# Changelog

What changed in each release, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). `npm run check:changelog` fails when the version in `package.json` has no section here. Steps an operator has to take for a release are in [docs/upgrade/](docs/upgrade/README.md).

## [Unreleased]

### Added

- Worker watch: `/api/health` reports the worker (`components.worker`, not part of the overall status), the app sends "Background worker stopped" and "running again" notifications itself, and the Docker Compose worker has a healthcheck (k3s: a liveness probe) that `npm run worker:health` runs
- Videos browsers cannot play (AVI, WMV, MPEG-TS, …) can be seeked anywhere while they convert: the viewer plays them over HLS (natively in Safari and recent Chrome, through hls.js elsewhere), converting from wherever the player jumps
- The File Manager link shows how many items expire within the next 24 hours (orange badge)
- File lists follow changes made elsewhere (another device, WebDAV, the CLI, an import, thumbnails and virus scans finishing) without a reload (`GET /api/events`)
- Photos (`/files/photos`, from the File Manager toolbar): every photo and video of the account by month, newest first by the date it was taken (else its file date), opened in the viewer and linked back to its folder
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

- Photos reads each page of the timeline from an index in its order (`Node_timeline_idx`, created by its migration) instead of sorting every photo and video of the account
- The daily cleanup finds old Status page samples through an index on their time (`HealthSample_at_idx`, created by its migration) instead of reading the whole table
- Pages re-render less while uploads run and notices come and go: only the transfers panel follows upload progress, and only the notice pill follows notices
- Pages load less JavaScript up front (14–21 kB gzip on every app page): the upload client and the QR encoder load when first used. `npm run check:bundle` keeps every page within its budget
- Name search uses a trigram index (`pg_trgm`, created by its migration) instead of reading every item of the account. Building it locks writes to the items table for a moment during the release
- Bulk operations, folder views and share pages run a constant number of queries
- Search (Ctrl/⌘ K) lists recent files from an index, in the same order every time (files added at the same moment used to swap)
- Every page reads the account's storage use from an index instead of every file row (`Node_accountId_type_size_idx` replaces two indexes it covers)

### Fixed

- An item menu offers Preview for documents the viewer shows (PDF, text, code, Markdown, tables, …) in the File Manager too, and no longer for download-only files in Favorites
- Tag search hits (`#tag`) and Favorites show, copy and share with the visibility of the folder each item is in, and move or copy from that folder, instead of the folder being viewed; the full-screen viewer on phones keeps keyboard focus inside and gives it back when closed; the Favorites list no longer lights up as a drop zone for files it does not take
- A search (Ctrl/⌘ K, `#tag` in the File Manager and Favorites), link activity or the upload links of a folder that fail to load say so instead of showing an empty list
- A failed action shows the server's message or "Something went wrong.", never a browser exception's text (sign-in, account switching and the other account actions could show it)
- Copy buttons (links, tokens, IDs, invite codes, request references) say "Copy failed" when nothing reached the clipboard instead of "copied", and copying also works on a LAN address over http
- systemd deployment: the worker and WebDAV run from the release bundle (`.app/current/tools`) instead of the checkout, so `git pull` and `npm ci` no longer change a running worker and `rollback.sh` takes them back with the app; all three units run with `NODE_ENV=production`. After pulling this, run `sudo deploy/scripts/systemd/install.sh` once
- k3s deploys back up the database before migrating (`deploy/scripts/k3s/backup.sh`, also for the daily cron), like the Docker Compose and systemd releases; a failed backup run no longer leaves a cut-off dump behind in any deployment
- GHCR images for a `main` commit are published only after CI passes on it, and quick successive merges no longer cancel each other's CI or image builds (k3s deploys pin `sha-<commit>`)
- Folder zips and account exports go through the Docker Compose and k3s Nginx without being held in its temporary files first (up to 1 GB of memory per download in Compose); Nginx is back on the 1.30 stable branch
- Releases and rollbacks restart the WebDAV server too when it runs (Docker Compose `dav` container, systemd `relayfiles-dav`), so it no longer keeps running the previous code against the new schema
- A tag search in the File Manager (`#tag`) updates after deleting, renaming, moving or retagging its results instead of showing them as they were
- The account deletion notices (admin Accounts page, Manage dialog, My Profile) give the server's `ACCOUNT_TTL_DAYS` instead of always 14 days
- Dialogs keep focus in the field being typed in while the page updates (an upload in progress moved it to Close), return focus to the button that opened them, and Escape closes only the top dialog
- An open item menu keeps keyboard focus while the page updates
- A file's tags in the list are buttons, so searching by a tag works from the keyboard
- The navigation drawer and bottom sheets keep keyboard focus inside while open, give it back to their button when closed, and take Escape only when they are on top
- The Delete key deletes the selected items, as the shortcuts list says
- The viewer ignores letters typed into the search over it and shortcuts with Ctrl/⌘ (Ctrl+K no longer also plays or pauses)
- The failed-upload toast gives the right count
- Items with names close to the 255-byte limit can be deleted, and get a shortened "name (2)" instead of failing when the name is taken
- Moving or copying a folder tree under a deep folder is refused instead of leaving items that answer 500
- A copy or restore of a file still waiting for its virus scan is scanned and no longer stays "Scanning" forever
- The ClamAV client no longer crashes or blocks the worker when clamd drops the connection mid-file
- A counted share download is kept when its resume grant cannot be stored (a delete-after-download file was used up without being received)
- The daily cleanup goes on with the other volumes when one fails; an alert that could not be queued no longer holds back the next one
- Zips leave out files missing from the disk and list them in "Not included.txt" (such a zip used to hang); "Download all" of a busy share link is slowed down like single downloads
- Several uploads of one name into one folder that finish together are all kept ("name (2)", …) instead of failing with a 500 and losing the bytes
- A resumable upload still arriving after `UPLOAD_TMP_TTL_HOURS` keeps its state through the daily cleanup and can continue
- An upload whose batch, link or token is gone by the time it finishes gives its reserved space and received bytes back at once, not after `UPLOAD_TMP_TTL_HOURS`
- WebDAV COPY or MOVE with Overwrite no longer deletes the destination when the copy is then refused (quota, item limit, busy volume): the new item is put in place first
- Link activity of a folder with more than about 65,000 items inside no longer fails with a 500
- Video conversion slots are timed by Redis's clock, so k3s nodes whose clocks drift no longer stop each other's conversions
- Moving favorites answers 404 for another account's items
- An upload-only link's size limit is bounded (a huge value gave a 500)
- Security log "Load more" no longer appends an old page after a reload
- The CLI keeps downloads in the current folder, stops an upload whose file changes while it is read, and resumes a download only when the server names its content (ETag)
- Account export lists a tree in the same order every time
- Uploads: one file per batch slot, hidden characters in names are rejected, a resumable upload is no longer counted twice, share links survive a replace, and chunks are dropped when finalizing fails
- Storage writes are serialized with volume moves, layout migrations and fsck
- Viewer: every literal `>` in converted subtitle cues is escaped; a subtitle read is not logged as a view

### Security

- Nginx access logs (all three deployments) no longer record share and upload link ids, WebDAV paths or query strings: those parts are logged as `:id` and `/dav/:path`
- `minimatch` under `archiver` (zip downloads) is held at 11.0.9 or later, past its pattern denial-of-service advisory
- Next.js 16.4.6: fixes the advisories for 16.4.4 and earlier (cache disclosure across root params and `use cache` arguments, the image optimizer's SVG check, response injection in self-hosted apps that forward fetched responses)
- `effect` (pulled in by Prisma's config loader) is held at 3.22.4 or later, past the ReDoS advisory in its template literal schemas
- Converted video playback (live or stored conversions) counts toward the link's and the account's daily traffic limits like the original; it went uncounted
- A folder's daily traffic limit also covers the links of files and folders inside it (another link no longer gets around it), and a private link that expired or ran out looks like a missing link to visitors
- Stopping an account export halfway through a file no longer crashes the app server (an uncaught error ended the process), and a WebDAV download that the client drops or that fails to read no longer leaves the file open or stops the DAV server
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
