import { describe, expect, it } from "vitest";
import { previewKindOf, videoNeedsTranscode } from "./media";

describe("previewKindOf", () => {
  it("previews images, videos and audio files", () => {
    expect(previewKindOf("file", "image")).toBe("image");
    expect(previewKindOf("file", "video")).toBe("video");
    expect(previewKindOf("file", "audio")).toBe("audio");
  });

  it("has nothing for other files and folders", () => {
    expect(previewKindOf("file", "other")).toBeNull();
    expect(previewKindOf("file", null)).toBeNull();
    expect(previewKindOf("folder", null)).toBeNull();
    expect(previewKindOf("folder", "image")).toBeNull();
  });
});

describe("videoNeedsTranscode", () => {
  it("converts containers browsers cannot play", () => {
    for (const name of ["clip.avi", "old.WMV", "camera.MTS", "disc.vob", "phone.3gp"]) expect(videoNeedsTranscode(name), name).toBe(true);
  });

  it("plays MP4, MOV, WebM and MKV as they are", () => {
    for (const name of ["a.mp4", "b.MOV", "c.webm", "d.mkv", "e.m4v", "noext", ".avi"]) expect(videoNeedsTranscode(name), name).toBe(false);
  });
});
