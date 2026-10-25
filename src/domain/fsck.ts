/**
 * Consistency check between the database tree and the files on a volume (npm run
 * storage:fsck). Both sides are maps from the path below the account root ("Trip/a.txt") to
 * what is there; the comparison lists what only one side has and what disagrees.
 */

export interface TreeEntry {
  type: "file" | "folder";
  size: bigint;
}

/** What the disk walk found: a file, a folder, or something the app never writes (symlink, socket). */
export interface DiskEntry {
  type: "file" | "folder" | "other";
  size: bigint;
}

export interface FsckFindings {
  /** In the database, not on disk (or not the same type). */
  missing: string[];
  /** On disk, not in the database: only the topmost path of an orphaned folder is listed. */
  orphans: string[];
  /** Files on both sides with different sizes. */
  sizeMismatch: string[];
}

const parentsOf = (path: string) => path.split("/").slice(0, -1).map((_, index, parts) => parts.slice(0, index + 1).join("/"));

export function compareTrees(db: ReadonlyMap<string, TreeEntry>, disk: ReadonlyMap<string, DiskEntry>): FsckFindings {
  const findings: FsckFindings = { missing: [], orphans: [], sizeMismatch: [] };
  for (const [path, entry] of db) {
    const found = disk.get(path);
    if (!found || found.type !== entry.type) findings.missing.push(path);
    else if (entry.type === "file" && found.size !== entry.size) findings.sizeMismatch.push(path);
  }
  const orphaned = new Set<string>();
  for (const [path, entry] of disk) {
    const known = db.get(path);
    if (known && known.type === entry.type) continue;
    // Inside a folder that is itself an orphan: moving that folder covers this one.
    if (parentsOf(path).some((parent) => orphaned.has(parent))) continue;
    orphaned.add(path);
  }
  findings.orphans = [...orphaned];
  for (const list of [findings.missing, findings.orphans, findings.sizeMismatch]) list.sort();
  return findings;
}
