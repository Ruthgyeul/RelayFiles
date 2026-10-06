import { describe, expect, it } from "vitest";
import { canShowInline, contentDisposition, parseRange, zipName } from "./serving";

describe("parseRange", () => {
  it("parses open, closed and suffix ranges", () => {
    expect(parseRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(parseRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("ignores missing or unsupported ranges and rejects impossible ones", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("bytes=0-1,5-6", 1000)).toBeNull();
    expect(parseRange("items=0-1", 1000)).toBeNull();
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=5-2", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });
});

describe("inline rules", () => {
  it("only shows media inline, never SVG or HTML", () => {
    expect(canShowInline("video/mp4")).toBe(true);
    expect(canShowInline("image/png")).toBe(true);
    expect(canShowInline("image/svg+xml")).toBe(false);
    expect(canShowInline("text/html")).toBe(false);
  });

  it("encodes non-ASCII file names", () => {
    expect(contentDisposition("attachment", "여행 사진.jpg")).toBe(`attachment; filename="__ __.jpg"; filename*=UTF-8''%EC%97%AC%ED%96%89%20%EC%82%AC%EC%A7%84.jpg`);
    expect(contentDisposition("inline", 'a"b.mp4')).toBe(`inline; filename="a_b.mp4"; filename*=UTF-8''a%22b.mp4`);
  });
});

describe("zipName", () => {
  it("names one folder, one file and a selection like the design", () => {
    expect(zipName([{ name: "Trip", folder: true }], "root")).toBe("Trip.zip");
    expect(zipName([{ name: "clip.final.mp4", folder: false }], "root")).toBe("clip.final.zip");
    expect(zipName([{ name: ".env", folder: false }], "root")).toBe(".env.zip");
    expect(zipName([{ name: "a", folder: false }, { name: "b", folder: true }], "Videos")).toBe("Videos · 2 items.zip");
  });
});
