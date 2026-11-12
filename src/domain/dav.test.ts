import { describe, expect, it } from "vitest";
import { davDepth, davHref, davMultistatus, davSegments } from "./dav";

describe("davSegments", () => {
  it("decodes the names below the prefix", () => {
    expect(davSegments("/dav", "/dav")).toEqual([]);
    expect(davSegments("/dav/", "/dav")).toEqual([]);
    expect(davSegments("/dav/Photos/Summer%202026/a%26b.jpg", "/dav")).toEqual(["Photos", "Summer 2026", "a&b.jpg"]);
  });

  it("refuses paths outside the prefix, traversal and invalid names", () => {
    expect(davSegments("/davx/a", "/dav")).toBeNull();
    expect(davSegments("/api/files", "/dav")).toBeNull();
    expect(davSegments("/dav/../etc", "/dav")).toBeNull();
    expect(davSegments("/dav/a%2Fb", "/dav")).toBeNull();
    expect(davSegments("/dav/%E0%A4%A", "/dav")).toBeNull();
  });
});

describe("davDepth", () => {
  it("reads 0 and 1, anything else is infinity", () => {
    expect(davDepth("0")).toBe("0");
    expect(davDepth(" 1 ")).toBe("1");
    expect(davDepth("infinity")).toBe("infinity");
    expect(davDepth(null)).toBe("infinity");
  });
});

describe("davMultistatus", () => {
  const at = new Date("2026-11-12T10:00:00Z");
  it("describes folders and files with escaped names", () => {
    const xml = davMultistatus("/dav", [
      { segments: [], folder: true, name: "root", size: 0n, mime: null, etag: null, createdAt: at, modifiedAt: at },
      { segments: ["R&D <notes>.txt"], folder: false, name: "R&D <notes>.txt", size: 12n, mime: "text/plain", etag: "abc", createdAt: at, modifiedAt: at },
    ]);
    expect(xml).toContain("<D:href>/dav/</D:href>");
    expect(xml).toContain("<D:resourcetype><D:collection/></D:resourcetype>");
    expect(xml).toContain("<D:href>/dav/R%26D%20%3Cnotes%3E.txt</D:href>");
    expect(xml).toContain("<D:displayname>R&amp;D &lt;notes&gt;.txt</D:displayname>");
    expect(xml).toContain("<D:getcontentlength>12</D:getcontentlength>");
    expect(xml).toContain("<D:getlastmodified>Thu, 12 Nov 2026 10:00:00 GMT</D:getlastmodified>");
    expect(xml).toContain('<D:getetag>"abc"</D:getetag>');
  });

  it("ends folder hrefs with a slash", () => {
    expect(davHref("/dav", ["a b", "c"], true)).toBe("/dav/a%20b/c/");
    expect(davHref("/dav", ["a b", "c"], false)).toBe("/dav/a%20b/c");
  });
});
