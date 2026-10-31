import { describe, expect, it } from "vitest";
import { isHiddenName, numberedName, planRenumber, renumberChanges, renumberDigits, renumberTempName, matchesReviewed, sortForRenumber, type RenumberCandidate } from "./renumber";

const file = (id: string, name: string, createdAt: number, modifiedAt: number | null = null, missing = false): RenumberCandidate => ({ id, name, type: "file", createdAt, modifiedAt, missing });
const folder = (id: string, name: string): RenumberCandidate => ({ id, name, type: "folder", createdAt: 0, modifiedAt: null, missing: false });

describe("renumberDigits", () => {
  it("pads to two digits and grows with the count", () => {
    expect(renumberDigits(0)).toBe(2);
    expect(renumberDigits(9)).toBe(2);
    expect(renumberDigits(99)).toBe(2);
    expect(renumberDigits(100)).toBe(3);
    expect(renumberDigits(1_000)).toBe(4);
  });
});

describe("numberedName", () => {
  it("keeps the last extension as it was written", () => {
    expect(numberedName(0, 2, "IMG_1234.JPG")).toBe("01.JPG");
    expect(numberedName(9, 3, "clip.final.mp4")).toBe("010.mp4");
    expect(numberedName(1, 2, "README")).toBe("02");
  });
});

describe("isHiddenName / renumberTempName", () => {
  it("treats dot names as hidden, temporary names included", () => {
    expect(isHiddenName(".env")).toBe(true);
    expect(isHiddenName("a.env")).toBe(false);
    expect(isHiddenName(renumberTempName("abc", 3))).toBe(true);
    expect(renumberTempName("abc", 3)).toBe(".relayfiles-renumber-abc-3");
  });
});

describe("sortForRenumber", () => {
  const files = [file("c", "b10.jpg", 3, 10), file("a", "b2.jpg", 1, 30), file("b", "a.jpg", 2, null)];

  it("sorts by name naturally", () => {
    expect(sortForRenumber(files, "name", "asc").map((f) => f.name)).toEqual(["a.jpg", "b2.jpg", "b10.jpg"]);
    expect(sortForRenumber(files, "name", "desc").map((f) => f.name)).toEqual(["b10.jpg", "b2.jpg", "a.jpg"]);
  });

  it("sorts by creation and modification time (missing modification time uses creation)", () => {
    expect(sortForRenumber(files, "created", "asc").map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(sortForRenumber(files, "modified", "asc").map((f) => f.id)).toEqual(["b", "c", "a"]);
    expect(sortForRenumber(files, "modified", "desc").map((f) => f.id)).toEqual(["a", "c", "b"]);
  });

  it("breaks ties by name, then id", () => {
    const tied = [file("z", "b.jpg", 5), file("y", "a.jpg", 5), file("x", "a.jpg", 5)];
    expect(sortForRenumber(tied, "created", "asc").map((f) => f.id)).toEqual(["x", "y", "z"]);
  });
});

describe("planRenumber", () => {
  it("numbers the files and leaves folders, hidden and missing files alone", () => {
    const plan = planRenumber([folder("f", "Album"), file("a", "z.jpg", 1), file("b", ".env", 2), file("c", "y.png", 3), file("d", "gone.mp4", 4, null, true)], "created", "asc");
    expect(plan.entries).toEqual([
      { id: "a", from: "z.jpg", to: "01.jpg" },
      { id: "c", from: "y.png", to: "02.png" },
    ]);
    expect(plan.skipped).toEqual([
      { id: "b", name: ".env", reason: "hidden" },
      { id: "d", name: "gone.mp4", reason: "missing" },
    ]);
    expect(plan.digits).toBe(2);
    expect(plan.conflict).toBeNull();
  });

  it("swaps names safely in the plan (both still listed)", () => {
    const plan = planRenumber([file("a", "02.jpg", 1), file("b", "01.jpg", 2)], "created", "asc");
    expect(renumberChanges(plan)).toEqual([
      { id: "a", from: "02.jpg", to: "01.jpg" },
      { id: "b", from: "01.jpg", to: "02.jpg" },
    ]);
  });

  it("counts files already numbered as unchanged", () => {
    const plan = planRenumber([file("a", "01.jpg", 1), file("b", "x.jpg", 2)], "created", "asc");
    expect(plan.entries).toHaveLength(2);
    expect(renumberChanges(plan)).toEqual([{ id: "b", from: "x.jpg", to: "02.jpg" }]);
  });

  it("refuses a new name taken by an item that keeps its name", () => {
    const plan = planRenumber([folder("f", "01.jpg"), file("a", "x.jpg", 1)], "name", "asc");
    expect(plan.conflict).toContain('"01.jpg"');
    expect(planRenumber([folder("f", "01"), file("a", "x.jpg", 1)], "name", "asc").conflict).toBeNull();
  });

  it("plans nothing for a folder without files", () => {
    expect(planRenumber([folder("f", "A")], "name", "asc")).toEqual({ entries: [], skipped: [], digits: 2, conflict: null });
  });
});

describe("matchesReviewed", () => {
  const plan = {
    entries: [
      { id: "a", from: "01.jpg", to: "01.jpg" },
      { id: "b", from: "x.jpg", to: "02.jpg" },
      { id: "c", from: "y.jpg", to: "03.jpg" },
    ],
  };

  it("compares only the changed files and the number of files", () => {
    expect(matchesReviewed([{ id: "b", to: "02.jpg" }, { id: "c", to: "03.jpg" }], plan, 3)).toBe(true);
    expect(matchesReviewed([{ id: "c", to: "02.jpg" }, { id: "b", to: "03.jpg" }], plan, 3)).toBe(false);
    expect(matchesReviewed([{ id: "b", to: "02.jpg" }], plan, 3)).toBe(false);
  });

  it("notices a file added or removed meanwhile", () => {
    expect(matchesReviewed([{ id: "b", to: "02.jpg" }, { id: "c", to: "03.jpg" }], plan, 2)).toBe(false);
    expect(matchesReviewed([{ id: "b", to: "02.jpg" }, { id: "c", to: "03.jpg" }], plan, 4)).toBe(false);
  });

  it("still accepts the whole plan without a count (first release's clients)", () => {
    expect(matchesReviewed(plan.entries.map(({ id, to }) => ({ id, to })), plan)).toBe(true);
    expect(matchesReviewed([{ id: "b", to: "02.jpg" }, { id: "c", to: "03.jpg" }], plan)).toBe(false);
  });
});
