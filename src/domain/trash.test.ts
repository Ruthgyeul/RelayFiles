import { describe, expect, it } from "vitest";
import { MS } from "@/config/policy";
import { deletesInText, groupByTop, originalLocation, retentionText, trashExpiresAt, deleteText, itemsLabel } from "./trash";

describe("groupByTop", () => {
  it("splits rows of several trees per top item, in their order", () => {
    const rows = [
      { id: "a", parentId: "root" },
      { id: "b", parentId: "root" },
      { id: "a1", parentId: "a" },
      { id: "b1", parentId: "b" },
      { id: "a11", parentId: "a1" },
    ];
    const groups = groupByTop(rows, ["a", "b"]);
    expect(groups.get("a")!.map((row) => row.id)).toEqual(["a", "a1", "a11"]);
    expect(groups.get("b")!.map((row) => row.id)).toEqual(["b", "b1"]);
  });

  it("drops rows outside the trees and keeps empty groups", () => {
    const groups = groupByTop(
      [
        { id: "x", parentId: "elsewhere" },
        { id: "y", parentId: null },
      ],
      ["a"],
    );
    expect(groups).toEqual(new Map([["a", []]]));
  });
});

describe("retention", () => {
  it("expires a retention window after the deletion", () => {
    expect(trashExpiresAt(new Date("2026-11-01T00:00:00Z"), 24).toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("words the window", () => {
    expect(retentionText(24)).toBe("24 hours");
    expect(retentionText(1)).toBe("1 hour");
  });

  it("counts down in whole hours", () => {
    const expiresAt = new Date("2026-11-02T00:00:00Z");
    const at = (msLeft: number) => expiresAt.getTime() - msLeft;
    expect(deletesInText(expiresAt, at(24 * MS.hour - MS.second))).toBe("Deletes in 24 hours");
    expect(deletesInText(expiresAt.toISOString(), at(90 * MS.minute))).toBe("Deletes in 2 hours");
    expect(deletesInText(expiresAt, at(MS.hour))).toBe("Deletes in 1 hour");
    expect(deletesInText(expiresAt, at(10 * MS.minute))).toBe("Deletes in less than an hour");
    expect(deletesInText(expiresAt, at(0))).toBe("Deletes soon");
    expect(deletesInText(expiresAt, at(-MS.hour))).toBe("Deletes soon");
  });
});

describe("originalLocation", () => {
  it("joins the folder names", () => {
    expect(originalLocation(["root", "Photos", "2024"])).toBe("root / Photos / 2024");
  });
});

describe("itemsLabel", () => {
  it("quotes one name and counts several", () => {
    expect(itemsLabel([{ name: "a.txt" }])).toBe('"a.txt"');
    expect(itemsLabel([{ name: "a" }, { name: "b" }])).toBe("2 items");
  });
});

describe("deleteText", () => {
  const file = { name: "a.mp4", type: "file", size: "2048", fileCount: 1 } as const;
  const folder = { name: "Trips", type: "folder", size: 3072, fileCount: 2 } as const;

  it("names one item, with the file's size or the folder's files", () => {
    expect(deleteText([file], 24)).toEqual({
      title: 'Delete "a.mp4"?',
      text: "2.0 KB will be moved to Recently deleted and can be restored for 24 hours, then it is removed for good. Share links to it stop working.",
    });
    expect(deleteText([folder], 1).text).toMatch(/^2 files · 3.1 KB .* restored for 1 hour, then it is/);
  });

  it("counts several items and their files", () => {
    expect(deleteText([file, folder], 24)).toMatchObject({ title: "Delete 2 items?", text: expect.stringMatching(/^3 files · 5.1 KB .*they are removed .* to them stop/) });
  });
});
