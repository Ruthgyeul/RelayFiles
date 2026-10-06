/** A file chosen for upload with its path relative to the drop or the picked folder. */
export interface UploadEntry {
  file: File;
  rel: string;
}

/** Files from an <input type="file"> (folder pickers set webkitRelativePath). */
export function entriesFromList(list: FileList | File[]): UploadEntry[] {
  return [...list].map((file) => ({ file, rel: file.webkitRelativePath || file.name }));
}

type Entry = FileSystemEntry;

function readAll(reader: FileSystemDirectoryReader): Promise<Entry[]> {
  return new Promise((resolve) => {
    const all: Entry[] = [];
    const next = () =>
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) resolve(all);
          else {
            all.push(...batch);
            next();
          }
        },
        () => resolve(all),
      );
    next();
  });
}

async function walk(entry: Entry, path: string, out: UploadEntry[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => (entry as FileSystemFileEntry).file(resolve, () => resolve(null)));
    if (file) out.push({ file, rel: path + file.name });
    return;
  }
  const children = await readAll((entry as FileSystemDirectoryEntry).createReader());
  await Promise.all(children.map((child) => walk(child, `${path}${entry.name}/`, out)));
}

/**
 * Files dropped from the operating system, walking dropped folders recursively (design
 * `readDrop`). Falls back to the flat file list when the browser has no entry API.
 */
export async function entriesFromDrop(transfer: DataTransfer): Promise<UploadEntry[]> {
  const roots = [...transfer.items].filter((item) => item.kind === "file").map((item) => item.webkitGetAsEntry?.() ?? null);
  if (roots.length === 0 || roots.some((root) => root === null)) return entriesFromList([...transfer.files]);
  const out: UploadEntry[] = [];
  await Promise.all(roots.map((root) => walk(root!, "", out)));
  return out;
}

/** True when a drag carries files from outside the page (not an in-app item move). */
export function hasFiles(transfer: DataTransfer | null): boolean {
  return !!transfer && [...transfer.types].includes("Files");
}
