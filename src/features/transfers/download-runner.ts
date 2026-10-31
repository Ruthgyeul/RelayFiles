import { uniqName } from "@/domain/names";
import type { FileEvents, RunnerEvents } from "./upload-runner";

/** One item saved by a {@link FolderDownloader}. */
export interface FolderDownloadItem {
  url: string;
  name: string;
  /** Expected bytes (a folder zip's is an estimate: its files without the zip headers). */
  size: number;
}

type DirectoryPicker = (options?: { id?: string; mode?: "read" | "readwrite"; startIn?: "downloads" }) => Promise<FileSystemDirectoryHandle>;

/** The File System Access folder picker, where the browser has one (Chromium on https or localhost). */
function directoryPicker(): DirectoryPicker | null {
  if (typeof window === "undefined" || !window.isSecureContext) return null;
  const picker = (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  return typeof picker === "function" ? picker.bind(window) : null;
}

export function canSaveToFolder(): boolean {
  return directoryPicker() !== null;
}

/**
 * Asks for the folder to save into. Must run inside a click handler (before any await). Null when
 * the user closed the picker; throws when the browser refused.
 */
export async function pickSaveFolder(): Promise<FileSystemDirectoryHandle | null> {
  const picker = directoryPicker();
  if (!picker) throw new Error("This browser cannot save into a folder.");
  try {
    return await picker({ id: "relayfiles-downloads", mode: "readwrite", startIn: "downloads" });
  } catch (caught) {
    if (caught instanceof DOMException && caught.name === "AbortError") return null;
    throw caught;
  }
}

const isNotFound = (caught: unknown) => caught instanceof DOMException && caught.name === "NotFoundError";

/** A free name in the folder: existing files are never replaced ("a (2).jpg"). */
async function freeName(dir: FileSystemDirectoryHandle, name: string, reserved: Set<string>): Promise<string> {
  const taken = new Set(reserved);
  for (;;) {
    const candidate = uniqName(taken, name, true);
    try {
      await dir.getFileHandle(candidate);
      taken.add(candidate);
    } catch (caught) {
      if (!isNotFound(caught)) throw caught;
      reserved.add(candidate);
      return candidate;
    }
  }
}

/** Client-safe text from a failed download response ({ success: false, error }). */
async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON: fall through to the generic text.
  }
  return "Download failed";
}

/**
 * Saves several files into a folder on the user's disk, one after another, streaming each
 * response straight to the file (nothing is held in memory). Each file can be cancelled; its
 * partial file is removed.
 */
export class FolderDownloader {
  private index = 0;
  private savedBefore = 0;
  private cancelled = false;
  private controller: AbortController | null = null;
  private readonly skipped = new Set<number>();
  private readonly names = new Set<string>();
  private failed = 0;
  private firstError: string | undefined;

  constructor(
    private readonly dir: FileSystemDirectoryHandle,
    private readonly items: readonly FolderDownloadItem[],
    private readonly events: Omit<RunnerEvents, "onError"> & FileEvents,
  ) {}

  start(): void {
    void this.run();
  }

  /** Stops every download; the file being saved is removed. */
  cancel(): void {
    this.cancelled = true;
    this.controller?.abort();
  }

  cancelFile(slot: number): boolean {
    if (this.cancelled || slot < this.index || slot >= this.items.length || this.skipped.has(slot)) return false;
    this.skipped.add(slot);
    if (slot === this.index) this.controller?.abort();
    else this.events.onFileCancelled?.(slot);
    return true;
  }

  private async run(): Promise<void> {
    for (; this.index < this.items.length; this.index += 1) {
      if (this.cancelled) return;
      const slot = this.index;
      if (this.skipped.has(slot)) continue;
      await this.save(slot, this.items[slot]!);
    }
    if (!this.cancelled) this.events.onComplete(this.failed, this.firstError);
  }

  private async save(slot: number, item: FolderDownloadItem): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    this.events.onFileStart?.(slot);
    let name: string | null = null;
    let received = 0;
    try {
      const response = await fetch(item.url, { signal: controller.signal, credentials: "same-origin" });
      if (!response.ok || !response.body) throw new Error(await responseError(response));
      name = await freeName(this.dir, item.name, this.names);
      const writable = await (await this.dir.getFileHandle(name, { create: true })).createWritable();
      const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, stream) => {
          received += chunk.byteLength;
          this.events.onFileProgress?.(slot, received);
          this.events.onProgress(this.savedBefore + received);
          stream.enqueue(chunk);
        },
      });
      await response.body.pipeThrough(counter).pipeTo(writable, { signal: controller.signal });
      this.savedBefore += received;
      this.events.onFileDone?.(slot);
    } catch (caught) {
      if (name) await this.dir.removeEntry(name).catch(() => undefined);
      if (controller.signal.aborted) {
        if (!this.cancelled) this.events.onFileCancelled?.(slot);
      } else {
        // fetch() rejects with a TypeError when the connection drops.
        const message = caught instanceof TypeError ? "Connection lost" : caught instanceof Error && caught.message ? caught.message : "Download failed";
        this.failed += 1;
        this.firstError ??= message;
        this.events.onFileFailed?.(slot, message);
      }
      this.events.onProgress(this.savedBefore);
    } finally {
      this.controller = null;
    }
  }
}
