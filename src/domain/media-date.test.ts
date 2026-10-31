import { describe, expect, it } from "vitest";
import { exifDateTaken, normalizeOffset, toInstant, videoDateTaken } from "./media-date";

type Entry = [tag: number, value: string];

/** A TIFF/EXIF block: IFD0 entries, then an Exif IFD (linked from IFD0 by tag 0x8769). */
function exif(ifd0: Entry[], exifIfd: Entry[], { little = true, header = true } = {}): Uint8Array {
  const bytes: number[] = [];
  const u16 = (value: number) => (little ? bytes.push(value & 0xff, value >> 8) : bytes.push(value >> 8, value & 0xff));
  const u32 = (value: number) => (little ? bytes.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24) : bytes.push(value >>> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff));
  const ifdSize = (count: number) => 2 + count * 12 + 4;
  const ifd0Count = ifd0.length + (exifIfd.length ? 1 : 0);
  const ifd0At = 8;
  const exifAt = ifd0At + ifdSize(ifd0Count);
  let dataAt = exifAt + (exifIfd.length ? ifdSize(exifIfd.length) : 0);
  const data: number[] = [];
  const write = (entries: Entry[], extra?: [number, number]) => {
    u16(entries.length + (extra ? 1 : 0));
    for (const [tag, value] of entries) {
      const text = [...value].map((char) => char.charCodeAt(0)).concat(0);
      u16(tag);
      u16(2);
      u32(text.length);
      if (text.length <= 4) {
        const inline = [...text, 0, 0, 0, 0].slice(0, 4);
        bytes.push(...inline);
      } else {
        u32(dataAt);
        data.push(...text);
        dataAt += text.length;
      }
    }
    if (extra) {
      u16(extra[0]);
      u16(4);
      u32(1);
      u32(extra[1]);
    }
    u32(0);
  };
  bytes.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]));
  u16(42);
  u32(ifd0At);
  write(ifd0, exifIfd.length ? [0x8769, exifAt] : undefined);
  if (exifIfd.length) write(exifIfd);
  bytes.push(...data);
  return new Uint8Array([...(header ? [0x45, 0x78, 0x69, 0x66, 0, 0] : []), ...bytes]);
}

describe("exifDateTaken", () => {
  it("reads DateTimeOriginal with its offset, in both byte orders", () => {
    for (const little of [true, false]) {
      expect(exifDateTaken(exif([[0x0132, "2024:06:01 08:00:00"]], [[0x9003, "2024:05:01 13:22:10"], [0x9011, "+09:00"]], { little }))).toEqual({ local: "2024-05-01T13:22:10", offset: "+09:00" });
    }
  });

  it("falls back to DateTimeDigitized, then the IFD0 DateTime", () => {
    expect(exifDateTaken(exif([], [[0x9004, "2023:01:02 03:04:05"]]))).toEqual({ local: "2023-01-02T03:04:05", offset: null });
    expect(exifDateTaken(exif([[0x0132, "2022:12:31 23:59:59"]], [], { header: false }))).toEqual({ local: "2022-12-31T23:59:59", offset: null });
  });

  it("returns null for damaged or empty data", () => {
    const whole = exif([], [[0x9003, "2024:05:01 13:22:10"]]);
    expect(exifDateTaken(whole.slice(0, 20))).toBeNull();
    expect(exifDateTaken(new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, 1, 2]))).toBeNull();
    expect(exifDateTaken(exif([[0x0132, "not a date"]], []))).toBeNull();
    expect(exifDateTaken(new Uint8Array())).toBeNull();
  });
});

describe("videoDateTaken", () => {
  it("prefers Apple's local creation date, then creation_time in UTC", () => {
    const both = ";FFMETADATA1\ncreation_time=2023-05-01T04:22:10.000000Z\ncom.apple.quicktime.creationdate=2023-05-01T13:22:10+0900\n[STREAM]\ncreation_time=2000-01-01T00:00:00Z\n";
    expect(videoDateTaken(both)).toEqual({ local: "2023-05-01T13:22:10", offset: "+09:00" });
    expect(videoDateTaken(";FFMETADATA1\ncreation_time=2023-05-01T04:22:10.000000Z\n")).toEqual({ local: "2023-05-01T04:22:10", offset: "+00:00" });
    expect(videoDateTaken(";FFMETADATA1\ntitle=a\\=b\n")).toBeNull();
    expect(videoDateTaken(";FFMETADATA1\n[STREAM]\ncreation_time=2023-05-01T04:22:10Z\n")).toBeNull();
  });
});

describe("normalizeOffset / toInstant", () => {
  const now = new Date("2026-10-31T00:00:00Z");

  it("normalizes offsets", () => {
    expect(normalizeOffset("+0900")).toBe("+09:00");
    expect(normalizeOffset("-05:30")).toBe("-05:30");
    expect(normalizeOffset("   ")).toBeNull();
  });

  it("uses the recorded offset, else the server's zone", () => {
    expect(toInstant({ local: "2024-05-01T13:22:10", offset: "+09:00" }, "UTC", now)?.toISOString()).toBe("2024-05-01T04:22:10.000Z");
    expect(toInstant({ local: "2024-05-01T13:22:10", offset: null }, "Asia/Seoul", now)?.toISOString()).toBe("2024-05-01T04:22:10.000Z");
    // Daylight-saving time in New York (UTC-4 in July, UTC-5 in January).
    expect(toInstant({ local: "2024-07-01T12:00:00", offset: null }, "America/New_York", now)?.toISOString()).toBe("2024-07-01T16:00:00.000Z");
    expect(toInstant({ local: "2024-01-01T12:00:00", offset: null }, "America/New_York", now)?.toISOString()).toBe("2024-01-01T17:00:00.000Z");
  });

  it("ignores unset camera clocks and future times", () => {
    expect(toInstant({ local: "1970-01-01T00:00:00", offset: "+00:00" }, "UTC", now)).toBeNull();
    expect(toInstant({ local: "2030-01-01T00:00:00", offset: "+00:00" }, "UTC", now)).toBeNull();
  });
});
