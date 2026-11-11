/**
 * Rewrites an EXIF (TIFF) block keeping only what describes when and how a photo was taken:
 * capture times, orientation, camera and exposure. Location (GPS IFD), serial numbers, owner
 * and author names, comments, maker notes, embedded XMP/IPTC and the embedded thumbnail
 * (IFD1, which can show the uncropped original) are dropped. An allowlist, so a tag this file
 * does not know is dropped too (docs/security.md "공유 링크·다운로드").
 *
 * Values keep the byte order of the source block, so no value is decoded and re-encoded.
 * Returns null for a block it cannot read safely; callers then keep less, never more.
 */

/** IFD0 tags kept. The Exif IFD pointer is rewritten, not copied. */
const IFD0_KEEP: ReadonlySet<number> = new Set([
  0x010f, // Make
  0x0110, // Model
  0x0112, // Orientation
  0x011a, // XResolution
  0x011b, // YResolution
  0x0128, // ResolutionUnit
  0x0132, // DateTime
  0x0213, // YCbCrPositioning
]);

/** Exif IFD tags kept: times and offsets, exposure, lens description and colour. */
const EXIF_KEEP: ReadonlySet<number> = new Set([
  0x829a, // ExposureTime
  0x829d, // FNumber
  0x8822, // ExposureProgram
  0x8827, // ISOSpeedRatings
  0x8830, // SensitivityType
  0x9000, // ExifVersion
  0x9003, // DateTimeOriginal
  0x9004, // DateTimeDigitized
  0x9010, // OffsetTime
  0x9011, // OffsetTimeOriginal
  0x9012, // OffsetTimeDigitized
  0x9101, // ComponentsConfiguration
  0x9201, // ShutterSpeedValue
  0x9202, // ApertureValue
  0x9203, // BrightnessValue
  0x9204, // ExposureBiasValue
  0x9205, // MaxApertureValue
  0x9207, // MeteringMode
  0x9208, // LightSource
  0x9209, // Flash
  0x920a, // FocalLength
  0x9290, // SubSecTime
  0x9291, // SubSecTimeOriginal
  0x9292, // SubSecTimeDigitized
  0xa000, // FlashpixVersion
  0xa001, // ColorSpace
  0xa002, // PixelXDimension
  0xa003, // PixelYDimension
  0xa217, // SensingMethod
  0xa300, // FileSource
  0xa301, // SceneType
  0xa402, // ExposureMode
  0xa403, // WhiteBalance
  0xa404, // DigitalZoomRatio
  0xa405, // FocalLengthIn35mmFilm
  0xa406, // SceneCaptureType
  0xa432, // LensSpecification
  0xa433, // LensMake
  0xa434, // LensModel
]);

const EXIF_IFD_POINTER = 0x8769;
const TIFF_MAGIC = 42;
const HEADER_BYTES = 8;
const ENTRY_BYTES = 12;
const INLINE_BYTES = 4;
/** Bytes per value of each TIFF type (1 BYTE … 12 DOUBLE). */
const TYPE_BYTES: Readonly<Record<number, number>> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const TYPE_LONG = 4;
/** IFDs larger than this are treated as damaged. */
const MAX_ENTRIES = 512;

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** The value bytes, in the source byte order. */
  value: Uint8Array;
}

/** Reads the kept entries of one IFD, or null when it runs past the block. */
function readIfd(bytes: Uint8Array, view: DataView, start: number, little: boolean, keep: ReadonlySet<number>): Entry[] | null {
  if (start < HEADER_BYTES || start + 2 > bytes.length) return null;
  const count = view.getUint16(start, little);
  if (count > MAX_ENTRIES || start + 2 + count * ENTRY_BYTES > bytes.length) return null;
  const entries: Entry[] = [];
  for (let index = 0; index < count; index++) {
    const at = start + 2 + index * ENTRY_BYTES;
    const tag = view.getUint16(at, little);
    if (!keep.has(tag)) continue;
    const type = view.getUint16(at + 2, little);
    const size = TYPE_BYTES[type];
    if (size === undefined) continue;
    const valueCount = view.getUint32(at + 4, little);
    const length = size * valueCount;
    const from = length <= INLINE_BYTES ? at + 8 : view.getUint32(at + 8, little);
    if (from + length > bytes.length) return null;
    entries.push({ tag, type, count: valueCount, value: bytes.slice(from, from + length) });
  }
  return entries;
}

/** The Exif IFD offset from IFD0's pointer entry, or null when there is none. */
function exifIfdOffset(bytes: Uint8Array, view: DataView, ifd0: number, little: boolean): number | null {
  const count = view.getUint16(ifd0, little);
  for (let index = 0; index < count; index++) {
    const at = ifd0 + 2 + index * ENTRY_BYTES;
    if (at + ENTRY_BYTES > bytes.length) return null;
    if (view.getUint16(at, little) === EXIF_IFD_POINTER && view.getUint16(at + 2, little) === TYPE_LONG) return view.getUint32(at + 8, little);
  }
  return null;
}

const even = (value: number) => value + (value % 2);
const ifdBytes = (entries: readonly Entry[]) => 2 + entries.length * ENTRY_BYTES + 4;
const outOfLine = (entries: readonly Entry[]) => entries.reduce((sum, entry) => sum + (entry.value.length > INLINE_BYTES ? even(entry.value.length) : 0), 0);

/** Writes one IFD at `start` with its out-of-line values right after it; returns the end offset. */
function writeIfd(out: Uint8Array, view: DataView, start: number, entries: readonly Entry[], little: boolean): number {
  view.setUint16(start, entries.length, little);
  let data = start + ifdBytes(entries);
  entries.forEach((entry, index) => {
    const at = start + 2 + index * ENTRY_BYTES;
    view.setUint16(at, entry.tag, little);
    view.setUint16(at + 2, entry.type, little);
    view.setUint32(at + 4, entry.count, little);
    if (entry.value.length <= INLINE_BYTES) {
      out.set(entry.value, at + 8);
    } else {
      view.setUint32(at + 8, data, little);
      out.set(entry.value, data);
      data += even(entry.value.length);
    }
  });
  view.setUint32(start + 2 + entries.length * ENTRY_BYTES, 0, little); // no next IFD: the thumbnail IFD1 is dropped
  return data;
}

/**
 * The kept part of a TIFF-format EXIF block (no "Exif\0\0" header). Null when the block is
 * damaged or nothing is left to keep.
 */
export function filterExif(tiff: Uint8Array): Uint8Array | null {
  try {
    if (tiff.length < HEADER_BYTES) return null;
    const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    const order = view.getUint16(0, false);
    const little = order === 0x4949;
    if (!little && order !== 0x4d4d) return null;
    if (view.getUint16(2, little) !== TIFF_MAGIC) return null;
    const ifd0Start = view.getUint32(4, little);
    const ifd0 = readIfd(tiff, view, ifd0Start, little, IFD0_KEEP);
    if (!ifd0) return null;
    const exifStart = exifIfdOffset(tiff, view, ifd0Start, little);
    const exif = exifStart === null || exifStart === ifd0Start ? [] : (readIfd(tiff, view, exifStart, little, EXIF_KEEP) ?? []);

    const first = [...ifd0];
    if (exif.length > 0) first.push({ tag: EXIF_IFD_POINTER, type: TYPE_LONG, count: 1, value: new Uint8Array(INLINE_BYTES) });
    first.sort((a, b) => a.tag - b.tag);
    exif.sort((a, b) => a.tag - b.tag);
    if (first.length === 0) return null;

    const exifAt = even(HEADER_BYTES + ifdBytes(first) + outOfLine(first));
    const total = exif.length > 0 ? exifAt + ifdBytes(exif) + outOfLine(exif) : exifAt;
    const out = new Uint8Array(total);
    const outView = new DataView(out.buffer);
    out.set(tiff.subarray(0, 2), 0);
    outView.setUint16(2, TIFF_MAGIC, little);
    outView.setUint32(4, HEADER_BYTES, little);
    const pointer = first.find((entry) => entry.tag === EXIF_IFD_POINTER);
    if (pointer) new DataView(pointer.value.buffer).setUint32(0, exifAt, little);
    writeIfd(out, outView, HEADER_BYTES, first, little);
    if (exif.length > 0) writeIfd(out, outView, exifAt, exif, little);
    return out;
  } catch {
    return null;
  }
}
