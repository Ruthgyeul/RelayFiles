import { describe, expect, it } from "vitest";
import { importRelPath } from "./import";

describe("importRelPath", () => {
  it("strips ./ and trailing slashes", () => {
    expect(importRelPath("./Movies/a.mp4")).toBe("Movies/a.mp4");
    expect(importRelPath("Movies/")).toBe("Movies");
  });

  it("places entries below the target folder", () => {
    expect(importRelPath("./a.mp4", "Imported/2026")).toBe("Imported/2026/a.mp4");
    expect(importRelPath("a.mp4", "/Imported/")).toBe("Imported/a.mp4");
  });

  it("skips the archive root", () => {
    expect(importRelPath("./")).toBeNull();
    expect(importRelPath(".", "Imported")).toBeNull();
  });

  it("refuses names that leave the archive", () => {
    expect(importRelPath("/etc/passwd")).toBeNull();
    expect(importRelPath("../outside.txt")).toBeNull();
    expect(importRelPath("a/../../b")).toBeNull();
    expect(importRelPath("a.txt", "../x")).toBeNull();
  });
});
