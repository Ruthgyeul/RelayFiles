import { describe, expect, it } from "vitest";
import { filterExif } from "./exif-filter";
import { exifDateTaken } from "./media-date";
import { exifPhoto } from "../../test/exif-fixture";

const has = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(Buffer.from(text));
const photo = exifPhoto;

describe("filterExif", () => {
  for (const little of [true, false]) {
    it(`keeps capture time, orientation and camera but drops location and identity (${little ? "II" : "MM"})`, () => {
      const out = filterExif(photo(little))!;
      expect(out).not.toBeNull();
      expect(exifDateTaken(out)).toEqual({ local: "2024-05-01T13:22:10", offset: "+09:00" });
      for (const kept of ["Apple", "iPhone 17 Pro", "back camera"]) expect(has(out, kept)).toBe(true);
      for (const dropped of ["37.5665", "Jaeah", "SERIAL", "maker secrets"]) expect(has(out, dropped)).toBe(false);
      // No GPS pointer and no IFD1 (embedded thumbnail) after IFD0.
      const view = new DataView(out.buffer);
      const count = view.getUint16(8, little);
      const tags = Array.from({ length: count }, (_, index) => view.getUint16(10 + index * 12, little));
      expect(tags).toEqual([0x010f, 0x0110, 0x0112, 0x8769]);
      expect(view.getUint32(10 + count * 12, little)).toBe(0);
    });
  }

  it("refuses damaged blocks instead of guessing", () => {
    expect(filterExif(Uint8Array.from([0x49, 0x49, 0x2a, 0x00]))).toBeNull();
    expect(filterExif(Uint8Array.from([0x49, 0x49, 0x2a, 0x00, 0xff, 0xff, 0x00, 0x00]))).toBeNull();
    expect(filterExif(Uint8Array.from([0x41, 0x41, 0x2a, 0x00, 0x08, 0, 0, 0]))).toBeNull();
    const cut = photo(true).subarray(0, 40);
    expect(filterExif(cut)).toBeNull();
  });
});
