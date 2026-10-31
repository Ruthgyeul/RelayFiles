import qrcode from "qrcode-generator";

/** Modules of light margin a scanner needs around the code (the QR standard's quiet zone). */
export const QR_QUIET_ZONE = 4;

/**
 * The QR code for `text` as rows of dark (true) and light modules. Error correction M reads
 * through a scratched screen or glare and keeps a share link small enough to scan from a phone.
 */
export function qrMatrix(text: string): boolean[][] {
  const code = qrcode(0, "M");
  code.addData(text);
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => code.isDark(row, col)));
}

/**
 * One SVG path for all dark modules (one unit per module, shifted by the quiet zone). Runs
 * of dark modules in a row become one rectangle, which keeps the path short.
 */
export function qrPath(matrix: readonly (readonly boolean[])[], quiet = QR_QUIET_ZONE): string {
  const parts: string[] = [];
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      parts.push(`M${start + quiet} ${y + quiet}h${x - start}v1h-${x - start}z`);
    }
  });
  return parts.join("");
}
