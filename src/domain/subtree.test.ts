import { describe, expect, it } from "vitest";
import { subtreePaths } from "./subtree";

const row = (id: string, parentId: string | null, name = id) => ({ id, parentId, name });

describe("subtreePaths", () => {
  it("lays out a tree below its top, depth first with siblings in order", () => {
    const rows = [row("t", "up", "Trip"), row("a", "t", "a.txt"), row("d", "t", "Day1"), row("b", "d", "b.txt"), row("c", "d", "c.txt"), row("z", "t", "z.txt")];
    expect(subtreePaths(rows, "t").map(({ row: entry, segments }) => [entry.id, segments.join("/")])).toEqual([
      ["t", ""],
      ["a", "a.txt"],
      ["d", "Day1"],
      ["b", "Day1/b.txt"],
      ["c", "Day1/c.txt"],
      ["z", "z.txt"],
    ]);
  });

  it("does not depend on the rows coming parents first", () => {
    const rows = [row("b", "d", "b.txt"), row("d", "t", "Day1"), row("t", null, "root")];
    expect(subtreePaths(rows, "t").map(({ segments }) => segments)).toEqual([[], ["Day1"], ["Day1", "b.txt"]]);
  });

  it("leaves out rows outside the tree and returns nothing without the top", () => {
    const rows = [row("t", null), row("a", "t"), row("x", "elsewhere"), row("y", "x")];
    expect(subtreePaths(rows, "t").map(({ row: entry }) => entry.id)).toEqual(["t", "a"]);
    expect(subtreePaths(rows, "missing")).toEqual([]);
  });

  it("keeps the caller's row type", () => {
    const [top] = subtreePaths([{ ...row("t", null), size: 3n }], "t");
    expect(top!.row.size).toBe(3n);
  });
});
