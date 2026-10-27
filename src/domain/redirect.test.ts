import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./redirect";

describe("safeReturnPath", () => {
  it("keeps same-site paths with their query and hash", () => {
    expect(safeReturnPath("/files")).toBe("/files");
    expect(safeReturnPath("/s/abc?view=grid#top")).toBe("/s/abc?view=grid#top");
    expect(safeReturnPath(["/admin", "/other"])).toBe("/admin");
  });

  it("falls back to / for missing or relative values", () => {
    expect(safeReturnPath(undefined)).toBe("/");
    expect(safeReturnPath("")).toBe("/");
    expect(safeReturnPath([])).toBe("/");
    expect(safeReturnPath("files")).toBe("/");
    expect(safeReturnPath("https://evil.com/")).toBe("/");
  });

  it("rejects paths a browser reads as another site", () => {
    for (const path of ["//evil.com", "/\\evil.com", "/\\/evil.com", "/\t/evil.com", "/\n/evil.com", "/%09/evil.com/../"]) {
      const result = safeReturnPath(path);
      expect(result.startsWith("//"), path).toBe(false);
      expect(new URL(result, "https://relayfiles.example").origin, path).toBe("https://relayfiles.example");
    }
    expect(safeReturnPath("/\\evil.com")).toBe("/");
    expect(safeReturnPath("/\t/evil.com")).toBe("/");
  });
});
