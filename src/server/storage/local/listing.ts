import "server-only";
import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { DiskEntry } from "@/domain/fsck";
import type { VolumeLayout } from "../layout";
import { userRootOf } from "../safe-path";
import { ASSET_ID } from "./assets";

// What is on disk, for npm run storage:fsck and volume checks.

export async function listTree(layout: VolumeLayout, accountId: string): Promise<Map<string, DiskEntry>> {
  const root = userRootOf(layout.root, accountId);
  const found = new Map<string, DiskEntry>();
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const name of await readdir(dir)) {
      const path = prefix ? `${prefix}/${name}` : name;
      const info = await lstat(join(dir, name), { bigint: true });
      if (info.isDirectory()) {
        found.set(path, { type: "folder", size: 0n });
        await walk(join(dir, name), path);
      } else {
        found.set(path, { type: info.isFile() ? "file" : "other", size: info.isFile() ? info.size : 0n });
      }
    }
  };
  await walk(root, "");
  return found;
}

export async function listAccountRoots(layout: VolumeLayout): Promise<string[]> {
  const names = await readdir(layout.users).catch(() => [] as string[]);
  return names.filter((name) => ASSET_ID.test(name));
}
