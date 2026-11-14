import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { zipResponse, type ZipEntry } from "./zip.service";

const LOCAL_FILE_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const CHUNK_BYTES = 64 * 1024;

/** A file stand-in that never ends on its own (like a large file on a slow connection). */
function endlessFile(): Readable {
  return new Readable({
    read() {
      this.push(Buffer.alloc(CHUNK_BYTES));
    },
  });
}

function countHeaders(zip: Buffer): number {
  let count = 0;
  for (let at = zip.indexOf(LOCAL_FILE_HEADER); at !== -1; at = zip.indexOf(LOCAL_FILE_HEADER, at + 1)) count++;
  return count;
}

describe("zipResponse", () => {
  it("opens one file at a time and archives every entry", async () => {
    let open = 0;
    let peak = 0;
    const file = (name: string): ZipEntry => ({
      name,
      open: async () => {
        peak = Math.max(peak, ++open);
        const stream = Readable.from([Buffer.from(name)]);
        stream.once("close", () => open--);
        return stream;
      },
    });
    const entries: ZipEntry[] = [{ name: "trip", folder: true }, file("trip/a.jpg"), file("trip/b.jpg"), file("trip/c.jpg")];

    const zip = await buffer(Readable.fromWeb(zipResponse(entries, "trip.zip").body! as never));

    expect(countHeaders(zip)).toBe(entries.length);
    expect(peak).toBe(1);
  });

  it("sends no faster than a given rate", async () => {
    const entries: ZipEntry[] = [{ name: "a.bin", open: async () => Readable.from([Buffer.alloc(4_000)]) }];
    const plain = await buffer(Readable.fromWeb(zipResponse(entries, "a.zip").body! as never));
    const started = Date.now();
    const throttled = await buffer(Readable.fromWeb(zipResponse(entries, "a.zip", { bytesPerSecond: 10_000 }).body! as never));
    // The same bytes, at no more than 10 kB/s: about 0.4 s for the ~4 kB zip.
    expect(throttled.length).toBe(plain.length);
    expect(Date.now() - started).toBeGreaterThanOrEqual(Math.floor((plain.length / 10_000) * 1_000) - 50);
  });

  it("closes the file being archived when the download is cancelled", async () => {
    const opened: Readable[] = [];
    const open = async () => {
      const stream = endlessFile();
      opened.push(stream);
      return stream;
    };
    const reader = zipResponse([{ name: "a.bin", open }, { name: "b.bin", open }], "files.zip").body!.getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setImmediate(resolve));

    expect(opened).toHaveLength(1);
    expect(opened[0]!.destroyed).toBe(true);
  });
});
