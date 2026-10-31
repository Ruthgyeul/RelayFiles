/**
 * When a photo or video was taken, from its own metadata ("Renumber files" by date taken):
 * EXIF DateTimeOriginal in images, creation_time in videos. Parsing is pure and bounds-checked;
 * damaged or missing metadata gives null.
 */

/** A wall-clock time ("2024-05-01T13:22:10") and its UTC offset ("+09:00") when the file records one. */
export interface MediaTime {
  local: string;
  offset: string | null;
}

/** Earliest time accepted: cameras without a set clock write 0 dates (1904, 1970, 0000). */
const EARLIEST_MS = Date.UTC(1971, 0, 1);

const TAG = {
  exifIfd: 0x8769,
  dateTime: 0x0132,
  dateTimeOriginal: 0x9003,
  dateTimeDigitized: 0x9004,
  offsetTimeOriginal: 0x9011,
  offsetTimeDigitized: 0x9012,
} as const;
const TYPE_ASCII = 2;
const TYPE_LONG = 4;
const IFD_ENTRY_BYTES = 12;
const EXIF_PREFIX = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/;
const OFFSET = /^([+-])(\d{2}):?(\d{2})$/;

/** Reads one IFD into tag → entry offset (within the TIFF block). */
function readIfd(view: DataView, start: number, little: boolean): Map<number, number> {
  const entries = new Map<number, number>();
  if (start < 0 || start + 2 > view.byteLength) return entries;
  const count = view.getUint16(start, little);
  for (let index = 0; index < count; index++) {
    const at = start + 2 + index * IFD_ENTRY_BYTES;
    if (at + IFD_ENTRY_BYTES > view.byteLength) break;
    entries.set(view.getUint16(at, little), at);
  }
  return entries;
}

/** An ASCII value of an IFD entry, without the trailing NUL. */
function asciiAt(view: DataView, entry: number | undefined, little: boolean): string | null {
  if (entry === undefined || view.getUint16(entry + 2, little) !== TYPE_ASCII) return null;
  const length = view.getUint32(entry + 4, little);
  const start = length <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
  if (length === 0 || start + length > view.byteLength) return null;
  let text = "";
  for (let index = 0; index < length; index++) {
    const code = view.getUint8(start + index);
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text.trim();
}

function exifLocal(value: string | null): string | null {
  const match = value ? EXIF_DATE.exec(value) : null;
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

/** "+0900" or "+09:00" → "+09:00"; anything else → null. */
export function normalizeOffset(value: string | null | undefined): string | null {
  const match = value ? OFFSET.exec(value.trim()) : null;
  return match ? `${match[1]}${match[2]}:${match[3]}` : null;
}

/**
 * The capture time in an EXIF block (as sharp's `metadata().exif` returns it, with or without the
 * "Exif\0\0" header): DateTimeOriginal, else DateTimeDigitized, else the IFD0 DateTime.
 */
export function exifDateTaken(exif: Uint8Array): MediaTime | null {
  const skip = EXIF_PREFIX.every((byte, index) => exif[index] === byte) ? EXIF_PREFIX.length : 0;
  if (exif.length < skip + 8) return null;
  const view = new DataView(exif.buffer, exif.byteOffset + skip, exif.length - skip);
  const order = view.getUint16(0, false);
  const little = order === 0x4949; // "II"
  if (!little && order !== 0x4d4d) return null; // "MM"
  if (view.getUint16(2, little) !== 42) return null;

  const ifd0 = readIfd(view, view.getUint32(4, little), little);
  const pointer = ifd0.get(TAG.exifIfd);
  const exifIfd = pointer !== undefined && view.getUint16(pointer + 2, little) === TYPE_LONG ? readIfd(view, view.getUint32(pointer + 8, little), little) : new Map<number, number>();

  const candidates: [number | undefined, number | undefined][] = [
    [exifIfd.get(TAG.dateTimeOriginal), exifIfd.get(TAG.offsetTimeOriginal)],
    [exifIfd.get(TAG.dateTimeDigitized), exifIfd.get(TAG.offsetTimeDigitized)],
    [ifd0.get(TAG.dateTime), undefined],
  ];
  for (const [dateEntry, offsetEntry] of candidates) {
    const local = exifLocal(asciiAt(view, dateEntry, little));
    if (local) return { local, offset: normalizeOffset(asciiAt(view, offsetEntry, little)) };
  }
  return null;
}

const ISO_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

function isoTime(value: string | undefined): MediaTime | null {
  const match = value ? ISO_TIME.exec(value.trim()) : null;
  if (!match) return null;
  const [, year, month, day, hour, minute, second, zone] = match;
  return { local: `${year}-${month}-${day}T${hour}:${minute}:${second}`, offset: zone === "Z" ? "+00:00" : normalizeOffset(zone) };
}

/** Global tags of `ffmpeg -f ffmetadata` output (before the first [STREAM] or [CHAPTER] section). */
function globalTags(ffmetadata: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const line of ffmetadata.split("\n")) {
    if (line.startsWith("[")) break;
    if (line.startsWith(";") || line.startsWith("#")) continue;
    const split = line.search(/(?<!\\)=/);
    if (split <= 0) continue;
    const unescape = (text: string) => text.replace(/\\(.)/g, "$1").trim();
    tags.set(unescape(line.slice(0, split)).toLowerCase(), unescape(line.slice(split + 1)));
  }
  return tags;
}

/**
 * The capture time of a video from `ffmpeg -f ffmetadata`: Apple's creationdate (local time with
 * its offset) first, then the container's creation_time (UTC).
 */
export function videoDateTaken(ffmetadata: string): MediaTime | null {
  const tags = globalTags(ffmetadata);
  const apple = isoTime(tags.get("com.apple.quicktime.creationdate"));
  if (apple) return apple;
  const created = isoTime(tags.get("creation_time"));
  return created ? { local: created.local, offset: created.offset ?? "+00:00" } : null;
}

/** Offset of `timeZone` from UTC at `utcMs`, in ms. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second")) - utcMs;
}

/**
 * The instant of a media time. Without a recorded offset the wall-clock time is read in
 * `timeZone` (the server's zone, JOBS_TIMEZONE). Times before 1971 or after `now` give null.
 */
export function toInstant(time: MediaTime, timeZone: string, now: Date): Date | null {
  const [date, clock] = time.local.split("T");
  const [year, month, day] = (date ?? "").split("-").map(Number);
  const [hour, minute, second] = (clock ?? "").split(":").map(Number);
  const wall = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!);
  if (!Number.isFinite(wall)) return null;
  let ms: number;
  if (time.offset) {
    const [, sign, hours, minutes] = OFFSET.exec(time.offset)!;
    ms = wall - (sign === "-" ? -1 : 1) * (Number(hours) * 60 + Number(minutes)) * 60_000;
  } else {
    // Two passes settle daylight-saving changes between the guess and the result.
    const first = wall - zoneOffsetMs(wall, timeZone);
    ms = wall - zoneOffsetMs(first, timeZone);
  }
  return ms >= EARLIEST_MS && ms <= now.getTime() ? new Date(ms) : null;
}
