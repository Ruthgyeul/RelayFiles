import { describe, expect, it } from "vitest";
import { canStripVideo, keptVideoTags, videoStripArgs } from "./video-metadata";

const ffmetadata = [
  ";FFMETADATA1",
  "major_brand=qt  ",
  "creation_time=2024-05-01T04:22:10Z",
  "com.apple.quicktime.location.ISO6709=+37.5665+126.9780+010.000/",
  "com.apple.quicktime.creationdate=2024-05-01T13:22:10+0900",
  "com.apple.quicktime.make=Apple",
  "com.apple.quicktime.software=26.1",
  "location=+37.5665+126.9780/",
  "[STREAM]",
  "make=ignored stream tag",
].join("\n");

describe("video metadata", () => {
  it("keeps capture times and the device in sensitive mode, nothing in all", () => {
    expect(keptVideoTags(ffmetadata, "sensitive")).toEqual([
      ["creation_time", "2024-05-01T04:22:10Z"],
      ["com.apple.quicktime.creationdate", "2024-05-01T13:22:10+0900"],
      ["com.apple.quicktime.make", "Apple"],
    ]);
    expect(keptVideoTags(ffmetadata, "all")).toEqual([]);
  });

  it("copies streams without metadata and writes back only the kept tags", () => {
    const args = videoStripArgs(["-i", "/in.mov"], "/out", "video/quicktime", [["creation_time", "2024-05-01T04:22:10Z"]])!;
    expect(args.join(" ")).toContain("-map 0:v -map 0:a? -map 0:s? -dn -c copy -map_metadata -1 -map_metadata:s -1 -map_chapters -1 -metadata creation_time=2024-05-01T04:22:10Z");
    expect(args.slice(-6)).toEqual(["-movflags", "+use_metadata_tags+faststart", "-f", "mov", "-y", "/out"]);
    expect(videoStripArgs(["-i", "/in.webm"], "/out", "video/webm", [])).not.toContain("-movflags");
    expect(videoStripArgs(["-i", "/in"], "/out", "video/x-unknown", [])).toBeNull();
    expect(canStripVideo("video/mp4")).toBe(true);
    expect(canStripVideo("video/x-unknown")).toBe(false);
  });
});
