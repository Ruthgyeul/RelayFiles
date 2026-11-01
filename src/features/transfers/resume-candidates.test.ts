import { describe, expect, it } from "vitest";
import { hasUnfinishedUploads, resumeCandidates, uploadIdIn } from "./resume-candidates";

const ENDPOINT = "/api/uploads/tus/vol-1";
const id = (n: number) => n.toString(16).padStart(32, "0");
const stored = (n: number, size: number, created: string, url = `https://files.example/api/uploads/tus/vol-1/${id(n)}`) => ({ size, creationTime: created, urlStorageKey: `key-${n}`, uploadUrl: url });

describe("uploadIdIn", () => {
  it("reads the upload id below the endpoint", () => {
    expect(uploadIdIn(`https://files.example${ENDPOINT}/${id(7)}`, ENDPOINT)).toBe(id(7));
    expect(uploadIdIn(`${ENDPOINT}/${id(7)}`, `${ENDPOINT}/`)).toBe(id(7));
  });

  it("refuses other volumes, nested paths, odd ids and missing urls", () => {
    expect(uploadIdIn(`https://files.example/api/uploads/tus/vol-2/${id(7)}`, ENDPOINT)).toBeNull();
    expect(uploadIdIn(`https://files.example${ENDPOINT}/x/${id(7)}`, ENDPOINT)).toBeNull();
    expect(uploadIdIn(`https://files.example${ENDPOINT}/not-an-id`, ENDPOINT)).toBeNull();
    expect(uploadIdIn(null, ENDPOINT)).toBeNull();
  });
});

describe("resumeCandidates", () => {
  it("keeps same-size uploads of this endpoint, newest first, up to max", () => {
    const list = [
      stored(1, 10, "Mon Oct 05 2026 10:00:00 GMT+0000"),
      stored(2, 10, "Mon Oct 05 2026 12:00:00 GMT+0000"),
      stored(3, 11, "Mon Oct 05 2026 13:00:00 GMT+0000"),
      stored(4, 10, "Mon Oct 05 2026 11:00:00 GMT+0000"),
      stored(5, 10, "Mon Oct 05 2026 14:00:00 GMT+0000", "https://files.example/api/uploads/tus/vol-2/x"),
    ];
    expect(resumeCandidates(list, 10, ENDPOINT, new Set(), 2).map((entry) => entry.uploadId)).toEqual([id(2), id(4)]);
  });

  it("skips uploads another file of the batch already took", () => {
    const list = [stored(1, 10, "Mon Oct 05 2026 10:00:00 GMT+0000"), stored(2, 10, "Mon Oct 05 2026 12:00:00 GMT+0000")];
    expect(resumeCandidates(list, 10, ENDPOINT, new Set([id(2)]), 3).map((entry) => entry.stored.urlStorageKey)).toEqual(["key-1"]);
  });
});

describe("hasUnfinishedUploads", () => {
  it("is true only while an upload is sending or paused", () => {
    expect(hasUnfinishedUploads([{ direction: "up", status: "active" }])).toBe(true);
    expect(hasUnfinishedUploads([{ direction: "up", status: "paused" }])).toBe(true);
    expect(hasUnfinishedUploads([{ direction: "up", status: "complete" }, { direction: "up", status: "error" }])).toBe(false);
    expect(hasUnfinishedUploads([{ direction: "down", status: "active" }])).toBe(false);
  });
});
