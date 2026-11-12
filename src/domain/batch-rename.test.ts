import { describe, expect, it } from "vitest";
import { DEFAULT_PATTERN, planBatchRename, renameChanges, renamedName, type RenamePattern } from "./batch-rename";

const pattern = (changes: Partial<RenamePattern>): RenamePattern => ({ ...DEFAULT_PATTERN, ...changes });
const file = (name: string, id = name) => ({ id, name, isFile: true });

describe("renamedName", () => {
  it("adds a prefix and suffix around the name, before the extension", () => {
    expect(renamedName({ name: "photo.jpg", isFile: true }, 0, pattern({ prefix: "trip-", suffix: "-final" }))).toBe("trip-photo-final.jpg");
  });

  it("numbers items with {n} from the start value, padded", () => {
    const numbered = pattern({ prefix: "{n} ", start: 9, digits: 3 });
    expect(renamedName({ name: "a.txt", isFile: true }, 0, numbered)).toBe("009 a.txt");
    expect(renamedName({ name: "b.txt", isFile: true }, 2, numbered)).toBe("011 b.txt");
  });

  it("finds and replaces, ignoring case unless asked", () => {
    expect(renamedName({ name: "IMG_IMG.png", isFile: true }, 0, pattern({ find: "img", replace: "Pic" }))).toBe("Pic_Pic.png");
    expect(renamedName({ name: "IMG_img.png", isFile: true }, 0, pattern({ find: "img", replace: "Pic", matchCase: true }))).toBe("IMG_Pic.png");
  });

  it("treats the search text and the replacement literally", () => {
    expect(renamedName({ name: "a.b(1).txt", isFile: true }, 0, pattern({ find: ".b(1)", replace: "$1" }))).toBe("a$1.txt");
  });

  it("changes case, and the extension too when it is not kept", () => {
    expect(renamedName({ name: "Report.PDF", isFile: true }, 0, pattern({ nameCase: "lower" }))).toBe("report.PDF");
    expect(renamedName({ name: "Report.PDF", isFile: true }, 0, pattern({ nameCase: "lower", keepExtension: false }))).toBe("report.pdf");
  });

  it("keeps a folder's dots as part of its name", () => {
    expect(renamedName({ name: "v1.2", isFile: false }, 0, pattern({ suffix: " old" }))).toBe("v1.2 old");
  });
});

describe("planBatchRename", () => {
  it("lists every item with its new name", () => {
    const rows = planBatchRename([file("a.txt"), file("b.txt")], pattern({ prefix: "x-" }), ["c.txt"]);
    expect(rows).toEqual([
      { id: "a.txt", from: "a.txt", to: "x-a.txt", error: null },
      { id: "b.txt", from: "b.txt", to: "x-b.txt", error: null },
    ]);
  });

  it("allows two selected items to swap names", () => {
    const rows = planBatchRename([file("1.txt"), file("2.txt")], pattern({ find: "", prefix: "" }), []);
    expect(rows.every((row) => row.error === null)).toBe(true);
    const swap = planBatchRename(
      [
        { id: "x", name: "a.txt", isFile: true },
        { id: "y", name: "b.txt", isFile: true },
      ],
      pattern({ find: "a", replace: "b" }),
      [],
    );
    expect(swap.find((row) => row.id === "x")?.error).toBe("Another selected item gets this name.");
  });

  it("marks names taken outside the selection, duplicates and invalid names", () => {
    const rows = planBatchRename([file("a.txt"), file("b.txt"), file("c.txt")], pattern({ find: "b", replace: "" }), ["d.txt", ".txt"]);
    expect(rows[1]!.error).toBe("An item with this name is already here.");
    expect(planBatchRename([file("a.txt"), file("b.txt")], pattern({ find: "a", replace: "b" }), [])[0]!.error).toBe("Another selected item gets this name.");
    expect(planBatchRename([file("a.txt")], pattern({ prefix: "x/" }), [])[0]!.error).toBe('Name can\'t contain "/".');
  });

  it("only checks the selection when the other names are unknown", () => {
    expect(planBatchRename([file("a.txt")], pattern({ prefix: "b" }), null)[0]!.error).toBeNull();
  });
});

describe("renameChanges", () => {
  it("sends only names that change", () => {
    expect(
      renameChanges([
        { id: "1", from: "a", to: "a", error: null },
        { id: "2", from: "b", to: "c", error: null },
      ]),
    ).toEqual([{ id: "2", name: "c" }]);
  });
});
