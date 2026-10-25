# Extra storage volumes

Files on the main volume (`STORAGE_ROOT`) are served by the template's generic X-Accel
location. Every additional SSD needs its own location, which `npm run volume:init -- <path>`
writes here as `<volumeId>.conf` (it is included before the generic one). Mount the same
path into the app, worker, tools and nginx services (deploy/docker-compose.volumes.yml;
docs/runbook.md "볼륨 추가·교체"). Docker Compose only: the systemd setup sends files from the
app and needs no location file.

A location must not add its own `Cache-Control`: the app's header passes through X-Accel and
lets browsers keep playback; a second one (`private, no-cache` in files written before this
release) disables that cache. Delete that line from older `<volumeId>.conf` files.

Each location also needs `disable_symlinks on from=<volume root>;` (Nginx opens the file again
after the app checked it; this refuses a symlink placed in between). `volume:init` writes it;
add it by hand to `<volumeId>.conf` files written before this release.
