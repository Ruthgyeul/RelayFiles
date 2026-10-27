import { describe, expect, it } from "vitest";
import { zipEntryName, zipSegment } from "./archive";

describe("zipSegment", () => {
  it("keeps ordinary names", () => {
    expect(zipSegment("Holiday 2026.mp4")).toBe("Holiday 2026.mp4");
    expect(zipSegment("사진.jpg")).toBe("사진.jpg");
  });

  it("replaces separators, drive letters and control characters", () => {
    expect(zipSegment("..\\..\\evil.txt")).toBe(".._.._evil.txt");
    expect(zipSegment("C:evil")).toBe("C_evil");
    expect(zipSegment("a\tb\u0000c")).toBe("a_b_c");
  });

  it("never yields a relative or empty segment", () => {
    expect(zipSegment("..")).toBe("_");
    expect(zipSegment(".")).toBe("_");
    expect(zipSegment("")).toBe("_");
  });
});

describe("zipEntryName", () => {
  it("cleans every segment of a path", () => {
    expect(zipEntryName("Shared/..\\..\\..\\evil.txt")).toBe("Shared/.._.._.._evil.txt");
    expect(zipEntryName("Shared/Docs/a.txt")).toBe("Shared/Docs/a.txt");
    expect(zipEntryName("Shared/../x")).toBe("Shared/_/x");
  });
});
