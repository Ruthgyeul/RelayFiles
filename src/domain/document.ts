/**
 * Turning the first bytes of a file into something the viewer can show: text in the right
 * encoding (or "binary"), CSV/TSV rows, formatted JSON, and spreadsheet cell text.
 */

const NUL = 0;
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const UTF16LE_BOM = [0xff, 0xfe] as const;
const UTF16BE_BOM = [0xfe, 0xff] as const;
/** Legacy Korean text (Windows "ANSI" on Korean systems) is common in older .txt and .smi files. */
const LEGACY_FALLBACK = "euc-kr";

const startsWith = (bytes: Uint8Array, prefix: readonly number[]) => prefix.every((byte, index) => bytes[index] === byte);

export interface DecodedText {
  text: string;
  /** Encoding label shown when it is not plain UTF-8. */
  encoding: "utf-8" | "utf-16le" | "utf-16be" | typeof LEGACY_FALLBACK;
}

/** Whether the bytes look like a binary file: a NUL byte within the first `window` bytes (UTF-16 excepted). */
export function looksBinary(bytes: Uint8Array, window: number): boolean {
  if (startsWith(bytes, UTF16LE_BOM) || startsWith(bytes, UTF16BE_BOM)) return false;
  const end = Math.min(bytes.length, window);
  for (let index = 0; index < end; index += 1) if (bytes[index] === NUL) return true;
  return false;
}

/**
 * Text of a file's first bytes. `truncated` means more of the file follows, so a character
 * cut in half at the end is dropped instead of being shown as a replacement character.
 * Returns null for binary content.
 */
export function decodeText(bytes: Uint8Array, truncated: boolean, sniffWindow: number): DecodedText | null {
  if (looksBinary(bytes, sniffWindow)) return null;
  const decode = (encoding: DecodedText["encoding"], body: Uint8Array, fatal: boolean) =>
    new TextDecoder(encoding, { fatal, ignoreBOM: true }).decode(body, { stream: truncated });
  if (startsWith(bytes, UTF16LE_BOM)) return { text: decode("utf-16le", bytes.subarray(UTF16LE_BOM.length), false), encoding: "utf-16le" };
  if (startsWith(bytes, UTF16BE_BOM)) return { text: decode("utf-16be", bytes.subarray(UTF16BE_BOM.length), false), encoding: "utf-16be" };
  const body = startsWith(bytes, UTF8_BOM) ? bytes.subarray(UTF8_BOM.length) : bytes;
  try {
    return { text: decode("utf-8", body, true), encoding: "utf-8" };
  } catch {
    try {
      return { text: decode(LEGACY_FALLBACK, body, true), encoding: LEGACY_FALLBACK };
    } catch {
      return { text: decode("utf-8", body, false), encoding: "utf-8" };
    }
  }
}

/** Number of lines as an editor counts them (a final newline does not start a new line). */
export function lineCount(text: string): number {
  if (text === "") return 0;
  let lines = 1;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) lines += 1;
  return text.endsWith("\n") ? lines - 1 : lines;
}

export interface Table {
  rows: string[][];
  /** Widest row (rows may have fewer cells). */
  columns: number;
  /** More rows followed than `maxRows`. */
  truncated: boolean;
}

/**
 * Rows of CSV or TSV text (RFC 4180 quoting: "a ""quoted"" cell", newlines inside quotes).
 * Stops after `maxRows` rows.
 */
export function parseDelimited(text: string, delimiter: "," | "\t", maxRows: number): Table {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let index = 0;
  const endRow = () => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = "";
  };
  while (index < text.length) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      endRow();
      if (rows.length === maxRows) {
        return { rows, columns: widest(rows), truncated: index + 1 < text.length };
      }
    } else cell += char;
    index += 1;
  }
  if (cell !== "" || row.length > 0) endRow();
  return { rows, columns: widest(rows), truncated: false };
}

const widest = (rows: string[][]) => rows.reduce((max, row) => Math.max(max, row.length), 0);

const JSON_INDENT = 2;

/**
 * JSON written on one line (minified API responses, exports), laid out with indentation.
 * Null when the text is already multi-line or is not valid JSON.
 */
export function prettyJson(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.includes("\n")) return null;
  try {
    return `${JSON.stringify(JSON.parse(trimmed), null, JSON_INDENT)}\n`;
  } catch {
    return null;
  }
}

/** A spreadsheet cell as read from a workbook (dates already converted from Excel serials). */
export type CellValue = string | number | boolean | Date | null;

const ISO_DATE_LENGTH = 10;
/** Excel keeps 15 significant digits; more only shows binary floating-point noise. */
const EXCEL_DIGITS = 15;
const ISO_DATETIME_LENGTH = 19;

/**
 * The text of a spreadsheet cell: dates as `2026-10-22` (or `2026-10-22 14:05:00` when they
 * carry a time), booleans as Excel shows them, numbers to Excel's 15 significant digits.
 */
export function formatCell(value: CellValue): string {
  if (value === null) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const iso = value.toISOString();
    const midnight = value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0;
    return midnight ? iso.slice(0, ISO_DATE_LENGTH) : iso.slice(0, ISO_DATETIME_LENGTH).replace("T", " ");
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return Number.isFinite(value) ? String(Number(value.toPrecision(EXCEL_DIGITS))) : String(value);
  return value;
}
