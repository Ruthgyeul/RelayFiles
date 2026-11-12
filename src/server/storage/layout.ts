import "server-only";
import { join } from "node:path";

/**
 * Directory layout of a storage volume (docs/architecture.md "스토리지"), layout version 1:
 *
 *   <root>/.relayfiles-volume          volume marker (id, layout version)
 *   <root>/users/<accountId>/...       each account's root folder; original files, real names
 *   <root>/system/tmp/uploads/         resumable upload chunks (same filesystem → atomic rename)
 *   <root>/system/thumbs/<accountId>/  generated thumbnails
 *   <root>/system/derived/<accountId>/ metadata-stripped copies for public share links
 *   <root>/system/previews/<accountId>/ screen-sized WebP previews for the media viewer
 *   <root>/system/transcoded/<accountId>/ MP4 conversions of often played videos the browser cannot decode
 *   <root>/system/versions/<accountId>/ earlier versions of replaced files (by version id)
 *   <root>/system/trash/               items waiting for permanent deletion
 */
export const MARKER_FILE = ".relayfiles-volume";

export const layoutOf = (root: string) => ({
  root,
  marker: join(root, MARKER_FILE),
  users: join(root, "users"),
  system: join(root, "system"),
  uploads: join(root, "system", "tmp", "uploads"),
  thumbs: join(root, "system", "thumbs"),
  derived: join(root, "system", "derived"),
  previews: join(root, "system", "previews"),
  transcoded: join(root, "system", "transcoded"),
  versions: join(root, "system", "versions"),
  trash: join(root, "system", "trash"),
});

export type VolumeLayout = ReturnType<typeof layoutOf>;

/**
 * Per-account files outside the account's tree, by kind (`system/<dir>/<accountId>/<id>`):
 * generated files keyed by node id, and earlier file versions keyed by their 16-character
 * version id. Volume moves copy them, account deletion removes them.
 */
export const ASSET_DIRS = { thumb: "thumbs", derived: "derived", preview: "previews", transcode: "transcoded", version: "versions" } as const satisfies Record<string, keyof VolumeLayout>;

/** Owner-only permissions: other users and services on the host cannot read user files. */
export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;
