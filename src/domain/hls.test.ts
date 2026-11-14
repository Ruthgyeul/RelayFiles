import { describe, expect, it } from "vitest";
import { parseDuration, parseHlsRequest, segmentCount, segmentName, segmentPlan, segmentStart, vodPlaylist } from "./hls";

describe("HLS requests", () => {
  it("accepts the playlist and segments of the video only", () => {
    expect(parseHlsRequest("index.m3u8", 8)).toEqual({ kind: "playlist" });
    expect(parseHlsRequest("0.ts", 8)).toEqual({ kind: "segment", index: 0 });
    expect(parseHlsRequest("7.ts", 8)).toEqual({ kind: "segment", index: 7 });
    for (const name of ["8.ts", "-1.ts", "1.5.ts", "01234567.ts", "../0.ts", "0.ts?x", "index.m3u", "0.mp4"]) expect(parseHlsRequest(name, 8), name).toBeNull();
  });

  it("names segments the way ffmpeg writes them", () => {
    expect(segmentName(12)).toBe("12.ts");
    expect(segmentStart(3, 4)).toBe(12);
  });
});

describe("VOD playlist", () => {
  it("lists fixed-length segments and a shorter last one", () => {
    expect(segmentCount(30.04, 4)).toBe(8);
    expect(segmentCount(8, 4)).toBe(2);
    expect(segmentCount(0.5, 4)).toBe(1);
    const playlist = vodPlaylist(10.5, 4);
    expect(playlist).toBe(
      ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:4", "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD", "#EXTINF:4,", "0.ts", "#EXTINF:4,", "1.ts", "#EXTINF:2.5,", "2.ts", "#EXT-X-ENDLIST", ""].join("\n"),
    );
  });

  it("adds the version to every segment name", () => {
    expect(vodPlaylist(5, 4, "?v=abc").split("\n").filter((line) => line.endsWith(".ts?v=abc"))).toEqual(["0.ts?v=abc", "1.ts?v=abc"]);
  });

  it("writes lengths without float noise", () => {
    expect(vodPlaylist(8.1, 4)).toContain("#EXTINF:0.1,");
  });
});

describe("ffmpeg duration", () => {
  it("reads the input length from ffmpeg's log", () => {
    expect(parseDuration("Input #0, avi, from 'x':\n  Duration: 00:00:30.04, start: 0.000000, bitrate: 359 kb/s")).toBeCloseTo(30.04);
    expect(parseDuration("  Duration: 01:02:03.50, start")).toBeCloseTo(3723.5);
    expect(parseDuration("  Duration: N/A, start")).toBeNull();
    expect(parseDuration("  Duration: 00:00:00.00, start")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });
});

describe("segment plan", () => {
  const written = (done: number[]) => (index: number) => done.includes(index);

  it("starts a conversion when none runs or the segment is behind it", () => {
    expect(segmentPlan(null, 3, 3, written([]))).toBe("restart");
    expect(segmentPlan({ start: 5, running: true }, 3, 3, written([]))).toBe("restart");
    expect(segmentPlan({ start: 0, running: false }, 3, 3, written([0, 1]))).toBe("restart");
  });

  it("waits for a running conversion that will reach the segment soon", () => {
    expect(segmentPlan({ start: 2, running: true }, 2, 3, written([]))).toBe("wait");
    expect(segmentPlan({ start: 2, running: true }, 5, 3, written([]))).toBe("wait");
    expect(segmentPlan({ start: 0, running: true }, 9, 3, written([0, 1, 2, 3, 4, 5, 6]))).toBe("wait");
  });

  it("jumps ahead when the segment is far past what the conversion wrote", () => {
    expect(segmentPlan({ start: 0, running: true }, 40, 3, written([0, 1, 2]))).toBe("restart");
  });

  it("gives up when a conversion started at the segment stopped without it", () => {
    expect(segmentPlan({ start: 3, running: false }, 3, 3, written([]))).toBe("failed");
  });
});
