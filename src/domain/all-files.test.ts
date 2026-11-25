import { describe, expect, it } from "vitest";
import { ALL_FILES_SORT_OPTION_LABEL, allFilesOrder, allFilesSortValue, decodeAllFilesCursor, encodeAllFilesCursor } from "./all-files";

describe("allFilesOrder", () => {
  it("reads the column and direction of each sort", () => {
    expect(allFilesOrder("date")).toEqual({ column: "createdAt", desc: true });
    expect(allFilesOrder("name")).toEqual({ column: "name", desc: false });
    expect(allFilesOrder("size-asc")).toEqual({ column: "size", desc: false });
    expect(ALL_FILES_SORT_OPTION_LABEL.date).toBe("Newest first");
  });
});

describe("all files cursor", () => {
  it("round-trips any name, and numbers for dates and sizes", () => {
    for (const value of ["Trip 2024 / day.1.jpg", "사진 (2).heic", "a%b"]) expect(decodeAllFilesCursor(encodeAllFilesCursor({ value, id: "abcdefghjkmn" }), "name")).toEqual({ value, id: "abcdefghjkmn" });
    expect(decodeAllFilesCursor(encodeAllFilesCursor({ value: "1730000000000", id: "abcdefghjkmn" }), "date")).toEqual({ value: "1730000000000", id: "abcdefghjkmn" });
  });
  it("refuses cursors it did not make for the sort", () => {
    expect(decodeAllFilesCursor("abcdefghjkmn.Trip", "size")).toBeNull();
    expect(decodeAllFilesCursor("bad id.1", "date")).toBeNull();
    expect(decodeAllFilesCursor("abcdefghjkmn.%E0%A4%A", "name")).toBeNull();
    expect(decodeAllFilesCursor("noseparator", "name")).toBeNull();
  });
  it("takes the sort value of a file", () => {
    const file = { createdAt: new Date(1_000), name: "a.txt", size: 42n };
    expect([allFilesSortValue(file, "date"), allFilesSortValue(file, "name-desc"), allFilesSortValue(file, "size")]).toEqual(["1000", "a.txt", "42"]);
  });
});
