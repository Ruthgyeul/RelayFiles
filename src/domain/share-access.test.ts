import { describe, expect, it } from "vitest";
import { DOCUMENT_PREVIEW } from "@/config/policy";
import { parseRange } from "./serving";
import { downloadBlock, downloadDecision, streamReach, withinReach, type DownloadFacts } from "./share-access";

describe("downloadBlock", () => {
  const open: DownloadFacts = { linkStreamOnly: false, streamOnly: false, downloadLimit: null, downloads: 0, busyLevel: 0 };

  it("allows downloads unless stream-only, used up or paused", () => {
    expect(downloadBlock(open)).toBeNull();
    expect(downloadBlock({ ...open, busyLevel: 1 })).toBeNull();
    expect(downloadBlock({ ...open, downloadLimit: 2, downloads: 1 })).toBeNull();
    expect(downloadBlock({ ...open, linkStreamOnly: true })).toBe("stream-only");
    expect(downloadBlock({ ...open, streamOnly: true })).toBe("stream-only");
    expect(downloadBlock({ ...open, downloadLimit: 1, downloads: 1 })).toBe("limit");
    expect(downloadBlock({ ...open, busyLevel: 2 })).toBe("paused");
  });
});

describe("downloadDecision", () => {
  const size = 1_000;
  const visitor = (range: string | null, granted = false, method = "GET") => downloadDecision({ method, range: parseRange(range, size), owner: false, granted });

  it("counts requests that send the first byte", () => {
    expect(visitor(null)).toBe("count");
    expect(visitor("bytes=0-")).toBe("count");
    expect(visitor("bytes=0-99")).toBe("count");
    expect(visitor("bytes=a-b")).toBe("count");
  });

  it("counts suffix ranges that cover the whole file", () => {
    expect(visitor("bytes=-99999999999")).toBe("count");
  });

  it("serves later ranges only after a counted start", () => {
    expect(visitor("bytes=1-")).toBe("deny");
    expect(visitor("bytes=-10")).toBe("deny");
    expect(visitor("bytes=500-")).toBe("deny");
    expect(visitor("bytes=500-", true)).toBe("allow");
    expect(visitor("bytes=-10", true)).toBe("allow");
  });

  it("never counts the owner, HEAD or ranges outside the file", () => {
    expect(downloadDecision({ method: "GET", range: null, owner: true, granted: false })).toBe("allow");
    expect(visitor(null, false, "HEAD")).toBe("allow");
    expect(visitor("bytes=5000-")).toBe("allow");
  });
});

describe("streamReach", () => {
  it("lets media and PDFs be read anywhere", () => {
    expect(streamReach("clip.mp4", "video")).toBe("any");
    expect(streamReach("song.mp3", "audio")).toBe("any");
    expect(streamReach("photo.jpg", "image")).toBe("any");
    expect(streamReach("paper.pdf", "other")).toBe("any");
  });

  it("limits text and asset previews to what the viewer reads", () => {
    expect(streamReach("notes.txt", "other")).toBe(DOCUMENT_PREVIEW.textMaxBytes);
    expect(streamReach("main.ts", "other")).toBe(DOCUMENT_PREVIEW.textMaxBytes);
    expect(streamReach("no-extension", null)).toBe(DOCUMENT_PREVIEW.textMaxBytes);
    expect(streamReach("logo.svg", "image")).toBe(DOCUMENT_PREVIEW.assetMaxBytes);
    expect(streamReach("report.docx", "other")).toBe(DOCUMENT_PREVIEW.assetMaxBytes);
  });

  it("refuses formats without a preview", () => {
    expect(streamReach("backup.zip", "other")).toBeNull();
    expect(streamReach("setup.exe", "other")).toBeNull();
    expect(streamReach("disk.iso", "other")).toBeNull();
  });
});

describe("withinReach", () => {
  const size = DOCUMENT_PREVIEW.textMaxBytes * 4;
  const reach = DOCUMENT_PREVIEW.textMaxBytes;

  it("accepts requests inside the reach", () => {
    expect(withinReach(reach, parseRange(`bytes=0-${reach - 1}`, size), size)).toBe(true);
    expect(withinReach(reach, parseRange("bytes=0-8191", size), size)).toBe(true);
    expect(withinReach(reach, null, 10)).toBe(true);
    expect(withinReach("any", null, size)).toBe(true);
  });

  it("refuses requests past it, whole large files and unknown formats", () => {
    expect(withinReach(reach, parseRange(`bytes=0-${reach}`, size), size)).toBe(false);
    expect(withinReach(reach, parseRange(`bytes=${reach}-`, size), size)).toBe(false);
    expect(withinReach(reach, parseRange("bytes=-10", size), size)).toBe(false);
    expect(withinReach(reach, null, size)).toBe(false);
    expect(withinReach(null, parseRange("bytes=0-0", size), size)).toBe(false);
  });
});
