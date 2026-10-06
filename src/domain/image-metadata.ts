/**
 * Lossless removal of location and camera metadata from images sent through public share
 * links (docs/plan.md §0, §13.5). Pixels are never re-encoded: only metadata segments are
 * dropped. Originals stay untouched; callers write the result as a separate copy.
 *
 * Returns null when the bytes are not a well-formed JPEG, PNG or WebP file.
 */
export function stripImageMetadata(bytes: Uint8Array, mime: string): Uint8Array | null {
  try {
    switch (mime) {
      case "image/jpeg":
        return stripJpeg(bytes);
      case "image/png":
      case "image/apng":
        return stripPng(bytes);
      case "image/webp":
        return stripWebp(bytes);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Formats {@link stripImageMetadata} handles without re-encoding. */
export const LOSSLESS_STRIP_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/apng", "image/webp"]);

class Writer {
  private readonly parts: Uint8Array[] = [];
  private length = 0;
  push(part: Uint8Array) {
    this.parts.push(part);
    this.length += part.length;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

const ascii = (bytes: Uint8Array, start: number, text: string) => [...text].every((char, index) => bytes[start + index] === char.charCodeAt(0));
const need = (bytes: Uint8Array, end: number) => {
  if (end > bytes.length) throw new RangeError("truncated");
};

// ---------------------------------------------------------------- JPEG

const JPEG = {
  marker: 0xff,
  soi: 0xd8,
  eoi: 0xd9,
  sos: 0xda,
  rstFirst: 0xd0,
  rstLast: 0xd7,
  tem: 0x01,
  app0: 0xe0,
  app1: 0xe1,
  app2: 0xe2,
  app14: 0xee,
  appLast: 0xef,
  com: 0xfe,
} as const;

/** EXIF orientation tag and its default (upright). */
const ORIENTATION_TAG = 0x0112;
const ORIENTATION_UPRIGHT = 1;
const TIFF_SHORT = 3;

/** APPn segments that only describe how to decode or colour the image. */
function keepJpegSegment(marker: number, bytes: Uint8Array, dataStart: number): boolean {
  if (marker === JPEG.app0) return ascii(bytes, dataStart, "JFIF") || ascii(bytes, dataStart, "JFXX");
  if (marker === JPEG.app2) return ascii(bytes, dataStart, "ICC_PROFILE\0");
  if (marker === JPEG.app14) return ascii(bytes, dataStart, "Adobe");
  return !(marker >= JPEG.app0 && marker <= JPEG.appLast) && marker !== JPEG.com;
}

/** Orientation from an APP1 Exif payload (TIFF IFD0), or null. */
export function exifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  if (!ascii(bytes, start, "Exif\0\0")) return null;
  const tiff = start + 6;
  const little = ascii(bytes, tiff, "II");
  if (!little && !ascii(bytes, tiff, "MM")) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, little);
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return null;
  const count = u16(ifd);
  for (let entry = 0; entry < count; entry += 1) {
    const at = ifd + 2 + entry * 12;
    if (at + 12 > end) return null;
    if (u16(at) === ORIENTATION_TAG && u16(at + 2) === TIFF_SHORT) return u16(at + 8);
  }
  return null;
}

/** A minimal APP1 Exif segment holding only the orientation tag (big-endian TIFF). */
function orientationSegment(orientation: number): Uint8Array {
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08];
  const ifd = [0x00, 0x01, 0x01, 0x12, 0x00, TIFF_SHORT, 0x00, 0x00, 0x00, 0x01, orientation >> 8, orientation & 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  const payload = [..."Exif\0\0"].map((char) => char.charCodeAt(0)).concat(tiff, ifd);
  const length = payload.length + 2;
  return Uint8Array.from([JPEG.marker, JPEG.app1, length >> 8, length & 0xff, ...payload]);
}

function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] !== JPEG.marker || bytes[1] !== JPEG.soi) return null;
  const out = new Writer();
  out.push(bytes.subarray(0, 2));
  let orientation: number | null = null;
  let orientationWritten = false;
  let at = 2;

  const writeOrientation = () => {
    if (orientationWritten) return;
    orientationWritten = true;
    if (orientation !== null && orientation !== ORIENTATION_UPRIGHT) out.push(orientationSegment(orientation));
  };

  while (at < bytes.length) {
    need(bytes, at + 2);
    if (bytes[at] !== JPEG.marker) return null;
    const marker = bytes[at + 1]!;
    if (marker === JPEG.marker) {
      at += 1; // fill byte
      continue;
    }
    if (marker === JPEG.eoi) {
      writeOrientation();
      out.push(bytes.subarray(at, at + 2));
      return out.bytes(); // anything after the image (MPF secondary images, trailers) is dropped
    }
    if ((marker >= JPEG.rstFirst && marker <= JPEG.rstLast) || marker === JPEG.tem) {
      out.push(bytes.subarray(at, at + 2));
      at += 2;
      continue;
    }
    need(bytes, at + 4);
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    const end = at + 2 + length;
    need(bytes, end);
    const isApp = marker >= JPEG.app0 && marker <= JPEG.appLast;
    if (marker === JPEG.app1 && orientation === null) orientation = exifOrientation(bytes, at + 4, end);
    // Metadata segments come before the frame: the orientation goes after the kept APPn ones.
    if (!isApp && marker !== JPEG.com) writeOrientation();
    if (keepJpegSegment(marker, bytes, at + 4)) out.push(bytes.subarray(at, end));
    at = end;

    if (marker === JPEG.sos) {
      // Entropy-coded data runs until the next marker that is not a stuffed 0xFF00 or a restart.
      const start = at;
      while (at + 1 < bytes.length) {
        if (bytes[at] === JPEG.marker) {
          const next = bytes[at + 1]!;
          if (next !== 0x00 && !(next >= JPEG.rstFirst && next <= JPEG.rstLast)) break;
        }
        at += 1;
      }
      if (at + 1 >= bytes.length) return null;
      out.push(bytes.subarray(start, at));
    }
  }
  return null;
}

// ---------------------------------------------------------------- PNG

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Text, EXIF and time chunks: where cameras and editors put location, device and dates. */
const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);
const PNG_CHUNK_OVERHEAD = 12;

function stripPng(bytes: Uint8Array): Uint8Array | null {
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Writer();
  out.push(bytes.subarray(0, PNG_SIGNATURE.length));
  let at = PNG_SIGNATURE.length;
  while (at < bytes.length) {
    need(bytes, at + 8);
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const end = at + PNG_CHUNK_OVERHEAD + length;
    need(bytes, end);
    if (!PNG_DROP.has(type)) out.push(bytes.subarray(at, end));
    at = end;
    if (type === "IEND") return out.bytes();
  }
  return null;
}

// ---------------------------------------------------------------- WebP

const RIFF_HEADER = 12;
const CHUNK_HEADER = 8;
const VP8X_EXIF_FLAG = 0x08;
const VP8X_XMP_FLAG = 0x04;

function stripWebp(bytes: Uint8Array): Uint8Array | null {
  if (!ascii(bytes, 0, "RIFF") || !ascii(bytes, 8, "WEBP")) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = Math.min(bytes.length, CHUNK_HEADER + view.getUint32(4, true));
  const chunks: Uint8Array[] = [];
  let at = RIFF_HEADER;
  while (at + CHUNK_HEADER <= riffEnd) {
    const type = String.fromCharCode(...bytes.subarray(at, at + 4));
    const size = view.getUint32(at + 4, true);
    const end = at + CHUNK_HEADER + size + (size % 2);
    need(bytes, Math.min(end, riffEnd));
    if (type !== "EXIF" && type !== "XMP ") {
      const chunk = bytes.slice(at, Math.min(end, riffEnd));
      if (type === "VP8X") chunk[CHUNK_HEADER] = chunk[CHUNK_HEADER]! & ~(VP8X_EXIF_FLAG | VP8X_XMP_FLAG);
      chunks.push(chunk);
    }
    at = end;
  }
  const bodyLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Writer();
  const header = bytes.slice(0, RIFF_HEADER);
  new DataView(header.buffer).setUint32(4, bodyLength + 4, true);
  out.push(header);
  chunks.forEach((chunk) => out.push(chunk));
  return out.bytes();
}
