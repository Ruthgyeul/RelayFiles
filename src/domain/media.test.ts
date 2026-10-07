import { describe, expect, it } from "vitest";
import { previewKindOf } from "./media";

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
