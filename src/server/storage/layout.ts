import "server-only";
import { join } from "node:path";

/**
 * Directory layout of a storage volume (docs/plan.md §13.5), layout version 1:
 *
 *   <root>/.relayfiles-volume          volume marker (id, layout version)
 *   <root>/users/<accountId>/...       each account's root folder; original files, real names
 *   <root>/system/tmp/uploads/         resumable upload chunks (same filesystem → atomic rename)
 *   <root>/system/thumbs/<accountId>/  generated thumbnails
 *   <root>/system/derived/<accountId>/ metadata-stripped copies for public share links
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
  trash: join(root, "system", "trash"),
});

export type VolumeLayout = ReturnType<typeof layoutOf>;

/** Owner-only permissions: other users and services on the host cannot read user files. */
export const DIR_MODE = 0o700;
export const FILE_MODE = 0o600;
