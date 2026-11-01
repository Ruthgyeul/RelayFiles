import "server-only";
import { lstat } from "node:fs/promises";

/** The errno code of a filesystem error ("" for anything else). */
export const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code ?? "";

/** Errors meaning "no hard link here" (another filesystem, too many links, not supported): copy instead. */
export const NO_HARD_LINK = new Set(["EXDEV", "EMLINK", "EPERM", "ENOTSUP", "EOPNOTSUPP"]);

/** True when something (a file, folder or link) exists at `path`. */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}
