/**
 * CSV (RFC 4180) for spreadsheet exports. Cells that a spreadsheet would run as a formula
 * (starting with = + - @, or a tab / carriage return before one) get a leading single quote,
 * so a file name such as `=HYPERLINK(...)` stays text when the export is opened.
 */

/** Leads the file so spreadsheet apps read it as UTF-8 (masked addresses use "•"). */
export const CSV_UTF8_BOM = "\uFEFF";

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

/** One cell: formula-guarded, then quoted when it holds a comma, quote or line break. */
export function csvCell(value: string | number): string {
  const text = String(value);
  const guarded = typeof value === "string" && FORMULA_START.test(text) ? `'${text}` : text;
  return NEEDS_QUOTES.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Rows joined with CRLF, ending with one. */
export function toCsv(rows: readonly (readonly (string | number)[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
