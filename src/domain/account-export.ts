/**
 * Account export (Profile, "Export account"): the tar's name, where its manifest sits, and
 * the paths of Favorites' organizing folders.
 */

/** Where the manifest is in the tar (after every file, so it can list what was skipped). */
export const EXPORT_MANIFEST_PATH = ".relayfiles/manifest.json";

const UNSAFE_FILE_NAME = /[^A-Za-z0-9._-]+/g;

/** "relayfiles-<account>-20261112.tar": the account name with only safe characters, the UTC date. */
export function exportFileName(accountName: string, at: Date): string {
  const name = accountName.replace(UNSAFE_FILE_NAME, "-").replace(/^-+|-+$/g, "") || "account";
  const day = at.toISOString().slice(0, 10).replace(/-/g, "");
  return `relayfiles-${name}-${day}.tar`;
}

export interface FolderLink {
  id: string;
  parentId: string | null;
  name: string;
}

/** Each organizing folder's names from the top of Favorites (folders in a loop or under a missing parent are left out). */
export function favoriteFolderPaths(folders: readonly FolderLink[]): Map<string, string[]> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const paths = new Map<string, string[]>();
  for (const folder of folders) {
    const names: string[] = [];
    const seen = new Set<string>();
    let complete = false;
    for (let current: FolderLink | undefined = folder; current && !seen.has(current.id); current = current.parentId === null ? undefined : byId.get(current.parentId)) {
      seen.add(current.id);
      names.unshift(current.name);
      if (current.parentId === null) complete = true;
    }
    if (complete) paths.set(folder.id, names);
  }
  return paths;
}
