/**
 * "Find duplicates": files with the same content, by SHA-256 and size (names do not matter).
 * Files without a recorded hash cannot be compared and are only counted.
 */

export interface DuplicateCandidate {
  id: string;
  sha256: string | null;
  size: number;
  /** ms */
  createdAt: number;
}

export interface DuplicateGroup<T extends DuplicateCandidate> {
  sha256: string;
  size: number;
  /** Oldest first: the first file is the one kept by default. */
  files: T[];
  /** Bytes the extra copies take in the quota: size × (copies − 1). */
  wasted: number;
}

/** Groups files with identical content; the groups that waste the most space come first. */
export function groupDuplicates<T extends DuplicateCandidate>(files: readonly T[]): { groups: DuplicateGroup<T>[]; unchecked: number } {
  const byContent = new Map<string, T[]>();
  let unchecked = 0;
  for (const file of files) {
    if (!file.sha256) {
      unchecked += 1;
      continue;
    }
    const key = `${file.sha256}:${file.size}`;
    const list = byContent.get(key);
    if (list) list.push(file);
    else byContent.set(key, [file]);
  }
  const groups: DuplicateGroup<T>[] = [];
  for (const list of byContent.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    const first = sorted[0]!;
    groups.push({ sha256: first.sha256!, size: first.size, files: sorted, wasted: first.size * (sorted.length - 1) });
  }
  groups.sort((a, b) => b.wasted - a.wasted || b.files.length - a.files.length || (a.sha256 < b.sha256 ? -1 : 1));
  return { groups, unchecked };
}

/** Ids selected for removal at first: every copy but the oldest of each group. */
export function defaultDuplicateSelection(groups: readonly DuplicateGroup<DuplicateCandidate>[]): string[] {
  return groups.flatMap((group) => group.files.slice(1).map((file) => file.id));
}

/** Groups in which every copy is selected; deleting them would lose the content entirely. */
export function fullySelectedGroups<T extends DuplicateCandidate>(groups: readonly DuplicateGroup<T>[], selected: ReadonlySet<string>): DuplicateGroup<T>[] {
  return groups.filter((group) => group.files.every((file) => selected.has(file.id)));
}
