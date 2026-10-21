# Extra storage volumes

Files on the main volume (`STORAGE_ROOT`) are served by the template's generic X-Accel
location. Every additional SSD needs its own location, which `npm run volume:init -- <path>`
writes here as `<volumeId>.conf` (it is included before the generic one). Mount the same
path into the app, worker and nginx services (docs/runbook.md "볼륨 추가·교체").

A location must not add its own `Cache-Control`: the app's header passes through X-Accel and
lets browsers keep playback; a second one (`private, no-cache` in files written before this
release) disables that cache. Delete that line from older `<volumeId>.conf` files.
