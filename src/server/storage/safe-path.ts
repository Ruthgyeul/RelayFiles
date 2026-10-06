import "server-only";
import { lstat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { STORAGE } from "@/config/policy";
import { isAccountId } from "@/domain/ids";
import { nameError } from "@/domain/names";

export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafePathError";
  }
}

const utf8Length = (value: string) => Buffer.byteLength(value, "utf8");

/** Absolute path of an account's root folder (`<volume>/users/<accountId>`). */
export function userRootOf(volumeRoot: string, accountId: string): string {
  if (!isAccountId(accountId)) throw new UnsafePathError("Invalid account id.");
  return resolve(volumeRoot, "users", accountId);
}

/**
 * Builds the absolute path for `segments` (folder names from the account root down) and
 * guarantees it stays inside the account root. Paths are always derived on the server from
 * node names; nothing here accepts a path from the client.
 */
export function resolveInsideUserRoot(volumeRoot: string, accountId: string, segments: readonly string[]): string {
  if (segments.length > STORAGE.maxFolderDepth) throw new UnsafePathError("Folder nesting is too deep.");
  for (const segment of segments) {
    const error = nameError(segment);
    if (error) throw new UnsafePathError(error);
  }
  const root = userRootOf(volumeRoot, accountId);
  const target = resolve(join(root, ...segments));
  if (target !== root && !target.startsWith(root + sep)) throw new UnsafePathError("Path escapes the account root.");
  if (utf8Length(target) > STORAGE.maxPathBytes) throw new UnsafePathError("Path is too long.");
  return target;
}

/**
 * Rejects the path when any existing component below the account root is a symbolic link,
 * so a planted link can never redirect reads or writes outside the account.
 */
export async function assertNoSymlinks(root: string, target: string): Promise<void> {
  const parts = relative(root, target).split(sep).filter(Boolean);
  let current = root;
  for (const part of [".", ...parts]) {
    current = part === "." ? root : join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new UnsafePathError("Symbolic links are not allowed in storage paths.");
    } catch (error) {
      if (error instanceof UnsafePathError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return; // the rest does not exist yet
      throw error;
    }
  }
}
