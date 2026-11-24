import { describe, expect, it } from "vitest";
import { ffmpegRelease, ffmpegReadsHeic, ffmpegStatusText, heicCopyName, isHeicType } from "./heic";

describe("isHeicType", () => {
  it("knows HEIC and HEIF", () => {
    expect(isHeicType("image/heic")).toBe(true);
    expect(isHeicType("image/heif")).toBe(true);
    expect(isHeicType("image/jpeg")).toBe(false);
  });
});

describe("ffmpegRelease", () => {
  it("reads distribution and release builds", () => {
    expect(ffmpegRelease("ffmpeg version 7.1.1-1+b1 Copyright (c) 2000-2025 the FFmpeg developers\nbuilt with gcc")).toEqual([7, 1]);
    expect(ffmpegRelease("ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023")).toEqual([6, 1]);
    expect(ffmpegRelease("ffmpeg version n7.0 Copyright")).toEqual([7, 0]);
    expect(ffmpegRelease("ffmpeg version 8.0-2 Copyright")).toEqual([8, 0]);
  });
  it("has no version for snapshots or other output", () => {
    expect(ffmpegRelease("ffmpeg version N-118000-g0123abcd Copyright")).toBeNull();
    expect(ffmpegRelease("")).toBeNull();
  });
});

describe("ffmpegReadsHeic", () => {
  it("needs ffmpeg 7.1 or later", () => {
    expect(ffmpegReadsHeic([7, 1])).toBe(true);
    expect(ffmpegReadsHeic([7, 2])).toBe(true);
    expect(ffmpegReadsHeic([8, 0])).toBe(true);
    expect(ffmpegReadsHeic([7, 0])).toBe(false);
    expect(ffmpegReadsHeic([6, 1])).toBe(false);
    expect(ffmpegReadsHeic(null)).toBe(false);
  });
});

describe("heicCopyName", () => {
  it("swaps the extension for .jpg", () => {
    expect(heicCopyName("IMG_0042.HEIC")).toBe("IMG_0042.jpg");
    expect(heicCopyName("trip.photo.heif")).toBe("trip.photo.jpg");
    expect(heicCopyName("noext")).toBe("noext.jpg");
    expect(heicCopyName(".heic")).toBe(".heic.jpg");
    expect(heicCopyName("Trip.v1/IMG_0042.HEIC")).toBe("Trip.v1/IMG_0042.jpg");
    expect(heicCopyName("Trip.v1/scan")).toBe("Trip.v1/scan.jpg");
  });
});

describe("ffmpegStatusText", () => {
  it("names the version and what it means for HEIC", () => {
    expect(ffmpegStatusText({ line: "ffmpeg version 7.1.1-1+b1 Copyright (c) 2000-2025 the FFmpeg developers", release: [7, 1] })).toEqual({ detail: "ffmpeg 7.1.1-1+b1 · HEIC photos supported", heic: true });
    expect(ffmpegStatusText({ line: "ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023", release: [6, 1] })).toEqual({ detail: "ffmpeg 6.1.1-3ubuntu5 · HEIC photos need ffmpeg 7.1: they get no thumbnail or preview", heic: false });
    expect(ffmpegStatusText(null).heic).toBe(false);
  });
});
