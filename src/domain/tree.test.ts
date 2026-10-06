import { describe, expect, it } from "vitest";
import {
  collapseCrumbs,
  effectiveVisibility,
  emptyTitle,
  itemCount,
  matchesFilter,
  pathString,
  settingTags,
  sortNodes,
  visibilityTag,
  type ShareSettings,
  type SortableNode,
} from "./tree";

const node = (name: string, extra: Partial<SortableNode> = {}): SortableNode => ({ type: "file", name, kind: "other", size: 0, createdAt: 0, ...extra });

describe("sortNodes (design sortNodes)", () => {
  const list = [
    node("b10.mp4", { kind: "video", size: 5, createdAt: 2 }),
    node("Photos", { type: "folder", kind: null, size: 50, createdAt: 1 }),
    node("b2.mp3", { kind: "audio", size: 9, createdAt: 3 }),
    node("a.zip", { size: 1, createdAt: 4 }),
  ];
  const names = (key: Parameters<typeof sortNodes>[1]) => sortNodes(list, key).map((n) => n.name);

  it("puts folders first and sorts names numerically", () => {
    expect(names("name")).toEqual(["Photos", "a.zip", "b2.mp3", "b10.mp4"]);
    expect(names("name-desc")).toEqual(["Photos", "b10.mp4", "b2.mp3", "a.zip"]);
  });

  it("sorts by date, size and type", () => {
    expect(names("date")).toEqual(["Photos", "a.zip", "b2.mp3", "b10.mp4"]);
    expect(names("date-asc")).toEqual(["Photos", "b10.mp4", "b2.mp3", "a.zip"]);
    expect(names("size")).toEqual(["Photos", "b2.mp3", "b10.mp4", "a.zip"]);
    expect(names("size-asc")).toEqual(["Photos", "a.zip", "b10.mp4", "b2.mp3"]);
    expect(names("type")).toEqual(["Photos", "b10.mp4", "b2.mp3", "a.zip"]);
  });

  it("does not mutate the input", () => {
    sortNodes(list, "size");
    expect(list[0]!.name).toBe("b10.mp4");
  });
});

describe("filters", () => {
  it("matches the design chips", () => {
    expect(matchesFilter({ type: "folder", kind: null }, "folder")).toBe(true);
    expect(matchesFilter({ type: "file", kind: "video" }, "video")).toBe(true);
    expect(matchesFilter({ type: "file", kind: "video" }, "audio")).toBe(false);
    expect(matchesFilter({ type: "folder", kind: null }, "all")).toBe(true);
  });
});

describe("crumbs", () => {
  const chain = ["root", "a", "b", "c", "d", "e", "f"].map((name) => ({ id: name, name }));

  it("collapses to root, gap and the last max-2 folders", () => {
    const slots = collapseCrumbs(chain, 6);
    expect(slots.map((slot) => (slot.kind === "gap" ? `…(${slot.hidden.map((c) => c.name).join(",")})` : slot.crumb.name))).toEqual(["root", "…(a,b)", "c", "d", "e", "f"]);
    expect(collapseCrumbs(chain, 3).map((slot) => (slot.kind === "gap" ? "…" : slot.crumb.name))).toEqual(["root", "…", "f"]);
    expect(collapseCrumbs(chain.slice(0, 3), 3)).toHaveLength(3);
  });

  it("builds the copyable path", () => {
    expect(pathString(chain.slice(0, 3))).toBe("/a/b");
    expect(pathString(chain.slice(0, 1))).toBe("/");
  });
});

describe("visibility", () => {
  it("inherits the nearest explicit setting, private by default", () => {
    expect(effectiveVisibility(["inherit", "public", "private"])).toBe("public");
    expect(effectiveVisibility(["inherit", "inherit"])).toBe("private");
    expect(effectiveVisibility(["private", "public"])).toBe("private");
  });

  it("labels the folder header like the design", () => {
    expect(visibilityTag("public", "public", false).label).toBe("Public");
    expect(visibilityTag("inherit", "public", false).label).toBe("Public · inherited");
    expect(visibilityTag("inherit", "private", false).label).toBe("Private · inherited");
    expect(visibilityTag("inherit", "private", true).label).toBe("Private");
  });
});

describe("settingTags (design tags)", () => {
  const base: ShareSettings = { visibility: "inherit", expiry: "Never", expAt: null, burn: false, downloadLimit: null, hasPassword: false, access: "both" };
  const now = 1_000_000;

  it("is empty for default settings", () => {
    expect(settingTags(base, 0, "private", now)).toEqual([]);
  });

  it("lists settings in the design order with Public first", () => {
    const tags = settingTags({ ...base, visibility: "public", expiry: "7 days", expAt: now + 2 * 86_400_000 + 3_600_000, burn: true, downloadLimit: 5, hasPassword: true, access: "stream" }, 2, null, now);
    expect(tags.map((t) => t.label)).toEqual(["Public", "Expires in 2d 1h", "Deletes after 1 download", "2 / 5 downloads", "Password", "Stream only"]);
  });

  it("marks blocked links and private items under public parents", () => {
    expect(settingTags({ ...base, downloadLimit: 3 }, 3, "private", now)[0]).toEqual({ icon: "prohibit", label: "Link blocked · 3 / 3 downloads" });
    expect(settingTags({ ...base, visibility: "private" }, 0, "public", now)[0]?.label).toBe("Private");
    expect(settingTags({ ...base, visibility: "private" }, 0, "private", now)).toEqual([]);
  });
});

describe("text", () => {
  it("matches the design's empty titles and counts", () => {
    expect(emptyTitle({ tagMode: true, wanted: [], query: "#", filter: "all" })).toBe("Type a tag after #");
    expect(emptyTitle({ tagMode: true, wanted: ["a", "b"], query: "#a #b", filter: "all" })).toBe("Nothing has all of #a #b");
    expect(emptyTitle({ tagMode: false, wanted: [], query: "x", filter: "all" })).toBe("No matches");
    expect(emptyTitle({ tagMode: false, wanted: [], query: "", filter: "video" })).toBe("Nothing of this type here");
    expect(emptyTitle({ tagMode: false, wanted: [], query: "", filter: "all" })).toBe("This folder is empty");
    expect(itemCount(1)).toBe("1 item");
    expect(itemCount(0)).toBe("0 items");
  });
});
