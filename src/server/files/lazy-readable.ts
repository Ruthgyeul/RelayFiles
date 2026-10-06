import "server-only";
import { Readable } from "node:stream";

/**
 * A stream that opens its source on first read. Zip archives queue many entries; opening
 * each file only when the archiver reaches it keeps file descriptors to one at a time.
 */
export class LazyReadable extends Readable {
  private source: Readable | null = null;
  private opening = false;

  constructor(private readonly open: () => Promise<Readable>) {
    super();
  }

  override _read(): void {
    if (this.source) {
      this.source.resume();
      return;
    }
    if (this.opening) return;
    this.opening = true;
    this.open().then(
      (source) => {
        this.source = source;
        source.on("data", (chunk: Buffer) => {
          if (!this.push(chunk)) source.pause();
        });
        source.on("end", () => this.push(null));
        source.on("error", (error) => this.destroy(error));
      },
      (error: Error) => this.destroy(error),
    );
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.source?.destroy();
    callback(error);
  }
}
