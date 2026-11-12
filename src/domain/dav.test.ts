import { describe, expect, it } from "vitest";
import { davDepth, davDestination, davHref, davLockDiscovery, davLockTimeout, davLockTokenOf, davMultistatus, davOverwrite, davProppatchResult, davSegments, davWithin, isMacMetadata } from "./dav";

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

describe("davWithin", () => {
  it("is true for the same path and paths below it", () => {
    expect(davWithin(["a"], ["a"])).toBe(true);
    expect(davWithin(["a"], ["a", "b"])).toBe(true);
    expect(davWithin([], ["a"])).toBe(true);
  });

  it("is false for siblings and parents", () => {
    expect(davWithin(["a", "b"], ["a"])).toBe(false);
    expect(davWithin(["a"], ["ab"])).toBe(false);
  });
});

describe("davDestination", () => {
  it("reads absolute URLs and paths below the prefix", () => {
    expect(davDestination("https://files.example/dav/New%20name.txt", "/dav")).toEqual(["New name.txt"]);
    expect(davDestination("/dav/a/b/", "/dav")).toEqual(["a", "b"]);
  });

  it("refuses missing headers and paths outside the prefix", () => {
    expect(davDestination(null, "/dav")).toBeNull();
    expect(davDestination("https://files.example/api/me", "/dav")).toBeNull();
    expect(davDestination("/dav/a%00b", "/dav")).toBeNull();
  });
});

describe("davOverwrite", () => {
  it("only refuses on F", () => {
    expect(davOverwrite(null)).toBe(true);
    expect(davOverwrite("T")).toBe(true);
    expect(davOverwrite("f")).toBe(false);
  });
});

describe("isMacMetadata", () => {
  it("matches AppleDouble files and .DS_Store only", () => {
    expect(isMacMetadata("._photo.jpg")).toBe(true);
    expect(isMacMetadata(".DS_Store")).toBe(true);
    expect(isMacMetadata("_photo.jpg")).toBe(false);
    expect(isMacMetadata(".hidden")).toBe(false);
  });
});

describe("davLockTimeout", () => {
  it("takes the first Second-N, capped", () => {
    expect(davLockTimeout("Second-600", 3600)).toBe(600);
    expect(davLockTimeout("Infinite, Second-4100000000", 3600)).toBe(3600);
    expect(davLockTimeout("Second-0", 3600)).toBe(1);
  });

  it("uses the maximum without a usable value", () => {
    expect(davLockTimeout(null, 3600)).toBe(3600);
    expect(davLockTimeout("Infinite", 3600)).toBe(3600);
  });
});

describe("davLockTokenOf", () => {
  it("finds the token in If and Lock-Token headers", () => {
    const token = "opaquelocktoken:0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(davLockTokenOf(`(<${token}>)`)).toBe(token);
    expect(davLockTokenOf(`<${token}>`)).toBe(token);
    expect(davLockTokenOf("<urn:other>")).toBeNull();
    expect(davLockTokenOf(null)).toBeNull();
  });
});

describe("lock and proppatch bodies", () => {
  it("escape the href and carry the token and timeout", () => {
    const body = davLockDiscovery("/dav/a&b.txt", "opaquelocktoken:1", 600, "0");
    expect(body).toContain("<D:href>/dav/a&amp;b.txt</D:href>");
    expect(body).toContain("<D:href>opaquelocktoken:1</D:href>");
    expect(body).toContain("<D:timeout>Second-600</D:timeout>");
    expect(davProppatchResult("/dav/a&b.txt")).toContain("<D:href>/dav/a&amp;b.txt</D:href>");
  });
});
