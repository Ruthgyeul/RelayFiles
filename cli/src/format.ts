const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
const STEP = 1024;

/** 1536 → "1.5 KB" (bytes as a number or a decimal string). */
export function formatSize(bytes: number | string): string {
  let value = Number(bytes);
  let unit = 0;
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP;
    unit++;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** Rows as columns separated by two spaces, each padded to its widest cell (the last is not padded). */
export function table(rows: readonly (readonly string[])[]): string {
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, index) => (widths[index] = Math.max(widths[index] ?? 0, cell.length)));
  return rows.map((row) => row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0))).join("  ")).join("\n");
}

/** "2026-11-12 10:30" in UTC, short enough for a table. */
export function formatTime(iso: string | null | undefined): string {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : "-";
}
