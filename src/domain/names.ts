/**
 * File and folder name rules, ported from the design prototype (`nameError`, `nameTaken`,
 * `uniqName`). The same rules run in the browser (instant feedback) and on the server
 * (authoritative), and they match the ext4 limits of the storage volume.
 */

/** ext4 allows at most 255 bytes per path segment. */
export const MAX_NAME_BYTES = 255;

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

/** Returns a user-facing error for an invalid name, or "" when the name is valid. */
export function nameError(name: string): string {
  if (!name || name.length === 0) return "Name can't be empty.";
  if (name === "." || name === "..") return `"${name}" is reserved by the file system.`;
  if (name.includes("/")) return 'Name can\'t contain "/".';
  if (name.includes("\0")) return "Name can't contain null characters.";
  if (/^\s|\s$/.test(name)) return "Name can't start or end with a space.";
  const bytes = utf8Length(name);
  if (bytes > MAX_NAME_BYTES) return `Name is too long (${bytes} / ${MAX_NAME_BYTES} bytes).`;
  return "";
}

/** Splits "movie.mp4" into ["movie", ".mp4"]; folders and dotfiles keep the whole name as base. */
export function splitExtension(name: string, isFile: boolean): [string, string] {
  if (!isFile) return [name, ""];
  const match = /^(.+?)(\.[^.]+)?$/.exec(name);
  return [match?.[1] ?? name, match?.[2] ?? ""];
}

/**
 * Returns `name` if it is free among `siblings`, otherwise the first free variant
 * "name (2).ext", "name (3).ext", … (an existing " (n)" suffix is replaced, not stacked).
 */
export function uniqName(siblings: Iterable<string>, name: string, isFile: boolean): string {
  const taken = new Set(siblings);
  if (!taken.has(name)) return name;
  const [rawBase, ext] = splitExtension(name, isFile);
  const base = rawBase.replace(/ \(\d+\)$/, "");
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}
