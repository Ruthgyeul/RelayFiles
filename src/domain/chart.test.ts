import { describe, expect, it } from "vitest";
import { areaPath, linePath, lineSegments, slotCenter } from "./chart";

describe("slotCenter", () => {
  it("places points in the middle of equal slots", () => {
    expect(slotCenter(0, 4)).toBe(12.5);
    expect(slotCenter(3, 4)).toBe(87.5);
    expect(slotCenter(0, 3)).toBe(16.67);
  });

  it("returns 0 for an empty series", () => {
    expect(slotCenter(0, 0)).toBe(0);
  });
});

describe("lineSegments", () => {
  it("keeps a full series as one segment", () => {
    expect(lineSegments([0, 50, 100, 25])).toEqual([
      [
        { x: 12.5, y: 0 },
        { x: 37.5, y: 50 },
        { x: 62.5, y: 100 },
        { x: 87.5, y: 25 },
      ],
    ]);
  });

  it("splits at null slots and drops them", () => {
    expect(lineSegments([null, 10, 20, null, null, 30])).toEqual([
      [
        { x: 25, y: 10 },
        { x: 41.67, y: 20 },
      ],
      [{ x: 91.67, y: 30 }],
    ]);
  });

  it("clamps values into the chart box", () => {
    expect(lineSegments([-5, 140])).toEqual([
      [
        { x: 25, y: 0 },
        { x: 75, y: 100 },
      ],
    ]);
  });

  it("returns no segments when there is no data", () => {
    expect(lineSegments([])).toEqual([]);
    expect(lineSegments([null, null])).toEqual([]);
  });
});

describe("linePath / areaPath", () => {
  const points = [
    { x: 25, y: 10 },
    { x: 75, y: 60 },
  ];

  it("draws the line top-down in SVG coordinates", () => {
    expect(linePath(points)).toBe("M25 90 L75 40");
  });

  it("closes the area down to the baseline", () => {
    expect(areaPath(points)).toBe("M25 90 L75 40 L75 100 L25 100 Z");
  });

  it("returns an empty area for no points", () => {
    expect(areaPath([])).toBe("");
  });
});
