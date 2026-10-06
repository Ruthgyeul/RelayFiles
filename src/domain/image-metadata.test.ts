import { describe, expect, it } from "vitest";
import { exifOrientation, stripImageMetadata } from "./image-metadata";

const text = (value: string) => [...value].map((char) => char.charCodeAt(0));
const has = (bytes: Uint8Array, value: string) => Buffer.from(bytes).includes(Buffer.from(value));

/** JPEG segment: marker + big-endian length + payload. */
const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];

/** Little-endian Exif payload with orientation and a fake GPS string after the IFD. */
function exif(orientation: number) {
  const tiff = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00];
  const ifd = [0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  return [...text("Exif\0\0"), ...tiff, ...ifd, ...text("GPS 37.56N 126.97E Galaxy S25")];
}

function jpeg({ orientation = 6, trailer = true } = {}) {
  return Uint8Array.from([
    0xff, 0xd8,
    ...segment(0xe0, [...text("JFIF\0"), 1, 2, 0, 0, 1, 0, 1, 0, 0]),
    ...segment(0xe1, exif(orientation)),
    ...segment(0xe1, text("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>Seoul</x:xmpmeta>")),
    ...segment(0xe2, [...text("ICC_PROFILE\0"), 1, 1, 9, 9]),
    ...segment(0xed, text("Photoshop 3.0\0IPTC city")),
    ...segment(0xfe, text("taken by Photographer")),
    ...segment(0xdb, [0, ...Array.from({ length: 64 }, () => 1)]),
    ...segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]),
    ...segment(0xda, [1, 1, 0, 0, 63, 0]),
    0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56,
    ...segment(0xc4, [0, ...Array.from({ length: 16 }, () => 0)]),
    ...segment(0xda, [1, 1, 0, 0, 63, 0]),
    0x78,
    0xff, 0xd9,
    ...(trailer ? [0xff, 0xd8, ...segment(0xe1, exif(1)), 0xff, 0xd9] : []),
  ]);
}

describe("stripImageMetadata · JPEG", () => {
  it("drops EXIF, XMP, IPTC, comments and trailing images but keeps decoding data", () => {
    const out = stripImageMetadata(jpeg(), "image/jpeg")!;
    for (const secret of ["GPS", "Galaxy", "Seoul", "IPTC", "Photographer"]) expect(has(out, secret), secret).toBe(false);
    expect(has(out, "JFIF")).toBe(true);
    expect(has(out, "ICC_PROFILE")).toBe(true);
    // Entropy data with stuffed bytes and restart markers, and both scans, survive as is.
    expect(Buffer.from(out).includes(Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]))).toBe(true);
    expect(Array.from(out.subarray(-2))).toEqual([0xff, 0xd9]);
    expect(out.filter((value, index) => value === 0xff && out[index + 1] === 0xd8)).toHaveLength(1);
  });

  it("keeps the orientation so photos are not shown sideways", () => {
    const out = stripImageMetadata(jpeg({ orientation: 6 }), "image/jpeg")!;
    const at = Buffer.from(out).indexOf(Buffer.from("Exif\0\0"));
    expect(at).toBeGreaterThan(0);
    expect(exifOrientation(out, at, out.length)).toBe(6);
    // Upright photos need no Exif at all.
    expect(has(stripImageMetadata(jpeg({ orientation: 1 }), "image/jpeg")!, "Exif")).toBe(false);
  });

  it("rejects files that are not complete JPEGs", () => {
    expect(stripImageMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00]), "image/jpeg")).toBeNull();
    expect(stripImageMetadata(jpeg().subarray(0, 60), "image/jpeg")).toBeNull();
    expect(stripImageMetadata(Uint8Array.from(text("not an image")), "image/jpeg")).toBeNull();
  });
});

function pngChunk(type: string, data: number[]) {
  const length = [0, 0, data.length >> 8, data.length & 0xff];
  return [...length, ...text(type), ...data, 1, 2, 3, 4];
}

describe("stripImageMetadata · PNG", () => {
  it("drops text, EXIF and time chunks and stops at IEND", () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...pngChunk("IHDR", Array.from({ length: 13 }, () => 0)),
      ...pngChunk("tEXt", text("Author\0Photographer")),
      ...pngChunk("eXIf", text("GPS")),
      ...pngChunk("iCCP", text("srgb")),
      ...pngChunk("IDAT", [1, 2, 3]),
      ...pngChunk("IEND", []),
      ...text("trailing GPS"),
    ]);
    const out = stripImageMetadata(png, "image/png")!;
    expect(has(out, "Photographer")).toBe(false);
    expect(has(out, "GPS")).toBe(false);
    expect(has(out, "iCCP")).toBe(true);
    expect(has(out, "IDAT")).toBe(true);
    expect(has(out, "IEND")).toBe(true);
  });
});

function riffChunk(type: string, data: number[]) {
  const size = data.length;
  return [...text(type), size & 0xff, size >> 8, 0, 0, ...data, ...(size % 2 ? [0] : [])];
}

describe("stripImageMetadata · WebP", () => {
  it("drops EXIF and XMP chunks, clears their flags and fixes the RIFF size", () => {
    const body = [
      ...text("WEBP"),
      ...riffChunk("VP8X", [0x0c | 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ...riffChunk("VP8 ", [9, 9, 9]),
      ...riffChunk("EXIF", text("GPS here")),
      ...riffChunk("XMP ", text("<xmp>Seoul</xmp>")),
    ];
    const webp = Uint8Array.from([...text("RIFF"), body.length & 0xff, body.length >> 8, 0, 0, ...body]);
    const out = stripImageMetadata(webp, "image/webp")!;
    expect(has(out, "GPS")).toBe(false);
    expect(has(out, "Seoul")).toBe(false);
    const view = new DataView(out.buffer, out.byteOffset);
    expect(view.getUint32(4, true)).toBe(out.length - 8);
    expect(out[20]).toBe(0x10); // only the alpha flag is left
  });

  it("returns null for other types", () => {
    expect(stripImageMetadata(Uint8Array.from([1, 2, 3]), "image/gif")).toBeNull();
  });
});
