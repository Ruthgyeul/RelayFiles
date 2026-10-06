import { describe, expect, it } from "vitest";
import { folderCount, homeUploadPlan, kindFromMime, mimeFromName, uploadFallbackName } from "./upload";

describe("homeUploadPlan (design startUpload)", () => {
  it("uses a single top-level folder as the upload folder", () => {
    expect(homeUploadPlan(["Trip/a.jpg", "Trip/day2/b.jpg"], "Upload x")).toEqual({ name: "Trip", rels: ["a.jpg", "day2/b.jpg"] });
  });

  it("names a single file upload after the file", () => {
    expect(homeUploadPlan(["movie.final.mp4"], "Upload x")).toEqual({ name: "movie.final", rels: ["movie.final.mp4"] });
    expect(homeUploadPlan([".env"], "Upload x").name).toBe(".env");
  });

  it("falls back to the upload time for mixed files", () => {
    expect(homeUploadPlan(["a.jpg", "Trip/b.jpg"], "Upload Oct 5, 3:12 PM").name).toBe("Upload Oct 5, 3:12 PM");
  });

  it("formats the fallback name like the design", () => {
    expect(uploadFallbackName(new Date(2026, 9, 5, 15, 12))).toBe("Upload Oct 5, 3:12 PM");
  });
});

describe("helpers", () => {
  it("counts folders and detects kinds", () => {
    expect(folderCount(["a/b/c.txt", "a/d.txt", "e.txt"])).toBe(2);
    expect(kindFromMime("video/mp4")).toBe("video");
    expect(kindFromMime("application/pdf")).toBe("other");
    expect(mimeFromName("Song.MP3")).toBe("audio/mpeg");
    expect(mimeFromName("noext")).toBe("application/octet-stream");
  });
});
