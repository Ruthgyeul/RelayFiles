import "server-only";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { pipeline } from "node:stream/promises";

/** Relative path → SHA-256 of every regular file below `root` (symbolic links are refused). */
export async function hashTree(root: string): Promise<Map<string, { sha256: string; size: number }>> {
  const result = new Map<string, { sha256: string; size: number }>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Symbolic link in a storage tree: ${relative(root, path)}`);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const hash = createHash("sha256");
        await pipeline(createReadStream(path), hash);
        result.set(relative(root, path), { sha256: hash.digest("hex"), size: (await lstat(path)).size });
      }
    }
  }
  await walk(root);
  return result;
}

/** Copies a directory tree, keeping file modes and times; fails if the target exists. */
export async function copyTree(source: string, target: string): Promise<void> {
  await cp(source, target, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
}

/** Differences between two hashed trees (empty when every file matches). */
export function treeDifferences(expected: Map<string, { sha256: string }>, actual: Map<string, { sha256: string }>): string[] {
  const problems: string[] = [];
  for (const [path, file] of expected) {
    const copy = actual.get(path);
    if (!copy) problems.push(`missing: ${path}`);
    else if (copy.sha256 !== file.sha256) problems.push(`different: ${path}`);
  }
  for (const path of actual.keys()) if (!expected.has(path)) problems.push(`unexpected: ${path}`);
  return problems;
}
