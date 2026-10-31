import { describe, expect, it } from "vitest";
import { qrMatrix, qrPath } from "./qr";

describe("qr codes", () => {
  it("builds a square code with the three finder patterns", () => {
    const matrix = qrMatrix("https://files.example/d/AbCdEf1234");
    const size = matrix.length;
    expect(size).toBeGreaterThanOrEqual(21);
    expect((size - 21) % 4).toBe(0);
    expect(matrix.every((row) => row.length === size)).toBe(true);
    // A finder pattern: a dark 7x7 ring around a light ring around a dark 3x3 centre.
    const finder = (top: number, left: number) => [0, 6].every((i) => matrix[top + i]![left + 3] && matrix[top + 3]![left + i]) && !matrix[top + 1]![left + 3] && matrix[top + 3]![left + 3];
    expect(finder(0, 0)).toBe(true);
    expect(finder(0, size - 7)).toBe(true);
    expect(finder(size - 7, 0)).toBe(true);
  });

  it("draws runs of dark modules as rectangles shifted by the quiet zone", () => {
    expect(qrPath([[true, true, false, true]], 4)).toBe("M4 4h2v1h-2zM7 4h1v1h-1z");
    expect(qrPath([[false], [true]], 0)).toBe("M0 1h1v1h-1z");
    expect(qrPath([[false, false]])).toBe("");
  });
});
