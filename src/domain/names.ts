/**
 * File and folder name rules: valid names, taken names and "Name (2)" for duplicates. The same rules run in the browser (instant feedback) and on the server
 * (authoritative), and they match the ext4 limits of the storage volume.
 */

/** ext4 allows at most 255 bytes per path segment. */
export const MAX_NAME_BYTES = 255;

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

/** C0 and C1 control characters (NUL, line breaks, escape, ...): invisible in lists, unsafe in headers and logs. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
/**
 * Bidirectional embedding, override and isolate marks: they reorder what is shown, so
 * "invoice\u202Efdp.exe" would read as "invoiceexe.pdf" and hide the real extension.
 */
const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/;

/** Returns a user-facing error for an invalid name, or "" when the name is valid. */
export function nameError(name: string): string {
  if (!name || name.length === 0) return "Name can't be empty.";
  if (name === "." || name === "..") return `"${name}" is reserved by the file system.`;
  if (name.includes("/")) return 'Name can\'t contain "/".';
  if (CONTROL_CHARACTERS.test(name)) return "Name can't contain control characters.";
  if (BIDI_CONTROLS.test(name)) return "Name can't contain text direction marks.";
  if (/^\s|\s$/.test(name)) return "Name can't start or end with a space.";
  const bytes = utf8Length(name);
  if (bytes > MAX_NAME_BYTES) return `Name is too long (${bytes} / ${MAX_NAME_BYTES} bytes).`;
  return "";
}

/** Splits "movie.mp4" into ["movie", ".mp4"]; folders and dotfiles keep the whole name as base. */
/**
 * The longest start of `text` that fits in `maxBytes` of UTF-8, never cutting a character (or a
 * surrogate pair) in half.
 */
export function utf8Prefix(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > maxBytes) break;
    bytes += size;
    end += char.length;
  }
  return text.slice(0, end);
}

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
