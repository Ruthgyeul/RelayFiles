import { describe, expect, it } from "vitest";
import { withoutSession, withSession } from "./device-session";

describe("device cookie updates", () => {
  const a = "a".repeat(32);
  const b = "b".repeat(32);

  it("adds a session as the newest and active one", () => {
    expect(withSession({ sessionIds: [a], activeSessionId: a }, b)).toEqual({ sessionIds: [a, b], activeSessionId: b });
    expect(withSession({ sessionIds: [a, b], activeSessionId: b }, a)).toEqual({ sessionIds: [b, a], activeSessionId: a });
  });

  it("removes a session and keeps or replaces the active one", () => {
    expect(withoutSession({ sessionIds: [a, b], activeSessionId: a }, b)).toEqual({ sessionIds: [a], activeSessionId: a });
    expect(withoutSession({ sessionIds: [a, b], activeSessionId: b }, b)).toEqual({ sessionIds: [a], activeSessionId: a });
    expect(withoutSession({ sessionIds: [a], activeSessionId: a }, a)).toEqual({ sessionIds: [], activeSessionId: null });
  });
});
