# Maintenance flag

`touch deploy/maintenance/on` makes Nginx answer every request with the static
"Under maintenance" page (503). `rm deploy/maintenance/on` brings the app back.
The release script sets and clears it around database migrations.
