#!/bin/sh
# Files and folders the app or worker create on the volume are private to the storage
# account (0600 / 0700), whatever the image's default umask is.
umask 077
exec "$@"
