import { crc32 as zlibCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { exifPhoto } from "../../test/exif-fixture";
import { exifOrientation, stripImageMetadata } from "./image-metadata";
import { exifDateTaken } from "./media-date";

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
  it("keeps only image and colour chunks and stops at IEND", () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...pngChunk("IHDR", Array.from({ length: 13 }, () => 0)),
      ...pngChunk("tEXt", text("Author\0Photographer")),
      ...pngChunk("eXIf", text("GPS")),
      ...pngChunk("iCCP", text("srgb")),
      ...pngChunk("caBX", text("C2PA claim")),
      ...pngChunk("prVt", text("editor data")),
      ...pngChunk("IDAT", [1, 2, 3]),
      ...pngChunk("IEND", []),
      ...text("trailing GPS"),
    ]);
    const out = stripImageMetadata(png, "image/png")!;
    expect(has(out, "Photographer")).toBe(false);
    expect(has(out, "GPS")).toBe(false);
    // Private and provenance chunks go too (allowlist).
    expect(has(out, "C2PA")).toBe(false);
    expect(has(out, "editor data")).toBe(false);
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
  it("drops EXIF, XMP and other chunks, clears their flags and fixes the RIFF size", () => {
    const body = [
      ...text("WEBP"),
      ...riffChunk("VP8X", [0x0c | 0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ...riffChunk("VP8 ", [9, 9, 9]),
      ...riffChunk("EXIF", text("GPS here")),
      ...riffChunk("XMP ", text("<xmp>Seoul</xmp>")),
      ...riffChunk("C2PA", text("manifest Busan")),
    ];
    const webp = Uint8Array.from([...text("RIFF"), body.length & 0xff, body.length >> 8, 0, 0, ...body]);
    const out = stripImageMetadata(webp, "image/webp")!;
    expect(has(out, "GPS")).toBe(false);
    expect(has(out, "Seoul")).toBe(false);
    expect(has(out, "Busan")).toBe(false);
    const view = new DataView(out.buffer, out.byteOffset);
    expect(view.getUint32(4, true)).toBe(out.length - 8);
    expect(out[20]).toBe(0x10); // only the alpha flag is left
  });

  it("returns null for other types", () => {
    expect(stripImageMetadata(Uint8Array.from([1, 2, 3]), "image/gif")).toBeNull();
  });
});

/** The TIFF block inside the first APP1 Exif segment of a JPEG, or null. */
function jpegExif(bytes: Uint8Array): Uint8Array | null {
  let at = 2;
  while (at + 4 < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1]!;
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    if (marker === 0xe1 && has(bytes.subarray(at + 4, at + 10), "Exif")) return bytes.subarray(at + 10, at + 2 + length);
    if (marker === 0xda) return null;
    at += 2 + length;
  }
  return null;
}

describe("stripImageMetadata · sensitive mode", () => {
  const camera = [...exifPhoto(true)];

  it("JPEG: keeps the capture time and camera, drops location, names and other segments", () => {
    const source = jpeg();
    // Replace the fixture's minimal Exif with a camera's full one.
    const full = Uint8Array.from([0xff, 0xd8, ...segment(0xe1, [...text("Exif\0\0"), ...camera]), ...source.subarray(2)]);
    const out = stripImageMetadata(full, "image/jpeg", "sensitive")!;
    expect(exifDateTaken(jpegExif(out)!)).toEqual({ local: "2024-05-01T13:22:10", offset: "+09:00" });
    for (const dropped of ["37.5665", "Jaeah", "SERIAL", "Seoul", "IPTC city", "Photographer"]) expect(has(out, dropped)).toBe(false);
    expect(has(out, "iPhone 17 Pro")).toBe(true);
    // "all" keeps no date.
    expect(exifDateTaken(jpegExif(stripImageMetadata(full, "image/jpeg", "all")!) ?? new Uint8Array())).toBeNull();
  });

  it("PNG: rewrites eXIf with its CRC and drops text chunks", () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...pngChunk("IHDR", Array.from({ length: 13 }, () => 0)),
      ...pngChunk("tEXt", text("Author\0Photographer")),
      ...pngChunk("eXIf", camera),
      ...pngChunk("IDAT", [1, 2, 3]),
      ...pngChunk("IEND", []),
    ]);
    const out = stripImageMetadata(png, "image/png", "sensitive")!;
    const at = Buffer.from(out).indexOf("eXIf");
    const length = new DataView(out.buffer, out.byteOffset).getUint32(at - 4);
    const data = out.subarray(at + 4, at + 4 + length);
    expect(exifDateTaken(data)).toEqual({ local: "2024-05-01T13:22:10", offset: "+09:00" });
    expect(has(out, "37.5665")).toBe(false);
    expect(has(out, "Photographer")).toBe(false);
    const crc = new DataView(out.buffer, out.byteOffset).getUint32(at + 4 + length);
    // A real CRC over type and data (the fixture's own chunks carry a dummy one).
    expect(crc).toBe(zlibCrc32(out.subarray(at, at + 4 + length)));
  });

  it("WebP: keeps a filtered EXIF chunk at the end and sets its VP8X flag", () => {
    const body = [
      ...text("WEBP"),
      ...riffChunk("VP8X", [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ...riffChunk("VP8 ", [9, 9, 9]),
      ...riffChunk("EXIF", [...text("Exif\0\0"), ...camera]),
      ...riffChunk("XMP ", text("<xmp>Seoul</xmp>")),
    ];
    const webp = Uint8Array.from([...text("RIFF"), body.length & 0xff, body.length >> 8, 0, 0, ...body]);
    const out = stripImageMetadata(webp, "image/webp", "sensitive")!;
    expect(has(out, "Seoul")).toBe(false);
    expect(has(out, "37.5665")).toBe(false);
    expect(out[20]! & 0x08).toBe(0x08);
    expect(out[20]! & 0x04).toBe(0);
    const at = Buffer.from(out).indexOf("EXIF");
    const size = new DataView(out.buffer, out.byteOffset).getUint32(at + 4, true);
    expect(exifDateTaken(out.subarray(at + 8, at + 8 + size))).toEqual({ local: "2024-05-01T13:22:10", offset: "+09:00" });
    expect(new DataView(out.buffer, out.byteOffset).getUint32(4, true)).toBe(out.length - 8);
  });
});
