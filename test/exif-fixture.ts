/** TIFF-format EXIF blocks for tests of metadata stripping (domain/exif-filter.ts, domain/image-metadata.ts). */

interface Tag {
  tag: number;
  type: number;
  /** Raw value bytes in the block's byte order. */
  value: number[];
  count?: number;
}

const ascii = (text: string) => [...`${text}\0`].map((char) => char.charCodeAt(0));

/** A TIFF block: IFD0 (with Exif and GPS pointers), the Exif IFD, a GPS IFD and IFD1, in either byte order. */
function tiff(little: boolean, ifd0: Tag[], exif: Tag[], gps: Tag[], ifd1: Tag[]): Uint8Array {
  const out: number[] = [];
  const u16 = (value: number) => (little ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff]);
  const u32 = (value: number) => (little ? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24] : [value >>> 24, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
  const size = (tags: Tag[]) => 2 + tags.length * 12 + 4 + tags.reduce((sum, tag) => sum + (tag.value.length > 4 ? tag.value.length + (tag.value.length % 2) : 0), 0);
  const ifd0At = 8;
  const exifAt = ifd0At + size(ifd0) + 24;
  const gpsAt = exifAt + size(exif);
  const ifd1At = gpsAt + size(gps);
  const write = (start: number, tags: Tag[], next: number) => {
    const block: number[] = [...u16(tags.length)];
    let data = start + 2 + tags.length * 12 + 4;
    const extra: number[] = [];
    for (const tag of tags) {
      block.push(...u16(tag.tag), ...u16(tag.type), ...u32(tag.count ?? (tag.type === 2 || tag.type === 7 ? tag.value.length : 1)));
      if (tag.value.length <= 4) block.push(...tag.value, ...Array.from({ length: 4 - tag.value.length }, () => 0));
      else {
        block.push(...u32(data));
        extra.push(...tag.value, ...(tag.value.length % 2 ? [0] : []));
        data += tag.value.length + (tag.value.length % 2);
      }
    }
    return [...block, ...u32(next), ...extra];
  };
  const pointers: Tag[] = [
    { tag: 0x8769, type: 4, value: u32(exifAt) },
    { tag: 0x8825, type: 4, value: u32(gpsAt) },
  ];
  out.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(ifd0At));
  out.push(...write(ifd0At, [...ifd0, ...pointers].sort((a, b) => a.tag - b.tag), ifd1At));
  while (out.length < exifAt) out.push(0);
  out.push(...write(exifAt, exif, 0), ...write(gpsAt, gps, 0), ...write(ifd1At, ifd1, 0));
  return Uint8Array.from(out);
}

/** A camera photo's EXIF: Apple iPhone, capture time with offset, owner name, serial, maker note, GPS and a thumbnail IFD. */
export function exifPhoto(little: boolean) {
  const u16 = (value: number) => (little ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff]);
  return tiff(
    little,
    [
      { tag: 0x010f, type: 2, value: ascii("Apple") },
      { tag: 0x0110, type: 2, value: ascii("iPhone 17 Pro") },
      { tag: 0x0112, type: 3, value: u16(6) },
      { tag: 0x013b, type: 2, value: ascii("Jaeah Lee") },
    ],
    [
      { tag: 0x9003, type: 2, value: ascii("2024:05:01 13:22:10") },
      { tag: 0x9011, type: 2, value: ascii("+09:00") },
      { tag: 0x927c, type: 7, value: ascii("maker secrets") },
      { tag: 0xa431, type: 2, value: ascii("SERIAL-123456") },
      { tag: 0xa434, type: 2, value: ascii("back camera") },
    ],
    [{ tag: 0x0002, type: 2, value: ascii("37.5665N 126.9780E") }],
    [{ tag: 0x0201, type: 4, value: [0, 0, 0, 0] }],
  );
}
