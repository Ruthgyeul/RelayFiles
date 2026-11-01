import { describe, expect, it } from "vitest";
import { SHARE_PROBLEM_TEXT, sharedTotals, shareTargetState } from "./share-target";

const ID = "3b241101-e2bb-4255-8caf-4136c566a962";

describe("shareTargetState", () => {
  it("claims files for a service worker id", () => {
    expect(shareTargetState({ share: ID })).toEqual({ kind: "claim", id: ID });
    expect(shareTargetState({ share: [ID, "other"] })).toEqual({ kind: "claim", id: ID });
  });

  it("reports the problems the worker and the server send", () => {
    expect(shareTargetState({ error: "unavailable" })).toEqual({ kind: "problem", problem: "unavailable" });
    expect(shareTargetState({ error: "unreadable" })).toEqual({ kind: "problem", problem: "unreadable" });
  });

  it("treats anything else as nothing shared", () => {
    expect(shareTargetState({})).toEqual({ kind: "problem", problem: "missing" });
    expect(shareTargetState({ share: "../../etc" })).toEqual({ kind: "problem", problem: "missing" });
    expect(shareTargetState({ share: ID.toUpperCase() })).toEqual({ kind: "problem", problem: "missing" });
    expect(shareTargetState({ error: "<script>" })).toEqual({ kind: "problem", problem: "missing" });
  });

  it("has words for every problem", () => {
    expect(Object.keys(SHARE_PROBLEM_TEXT).sort()).toEqual(["missing", "unavailable", "unreadable"]);
  });
});

describe("sharedTotals", () => {
  it("counts files and bytes", () => {
    expect(sharedTotals([])).toEqual({ count: 0, bytes: 0 });
    expect(sharedTotals([{ size: 3 }, { size: 1_000 }])).toEqual({ count: 2, bytes: 1_003 });
  });
});
