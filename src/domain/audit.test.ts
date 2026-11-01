import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, AUDIT_GROUPS, auditActionLabel, auditGroupActions, auditTargetText, isAuditAction } from "./audit";

describe("audit actions", () => {
  it("recognizes recorded actions only", () => {
    expect(isAuditAction("account.delete")).toBe(true);
    expect(isAuditAction("account.hack")).toBe(false);
  });

  it("puts every action in exactly one filter group", () => {
    const grouped = AUDIT_GROUPS.flatMap((group) => group.actions);
    expect([...grouped].sort()).toEqual([...AUDIT_ACTIONS].sort());
  });

  it("lists the actions of a group", () => {
    expect(auditGroupActions("signup")).toEqual(["signup.mode", "invite.create", "invite.revoke"]);
  });

  it("labels every action", () => {
    for (const action of AUDIT_ACTIONS) expect(auditActionLabel(action)).toMatch(/^[A-Z]/);
    expect(auditActionLabel("token.reveal")).toBe("Viewed admin token");
  });
});

describe("auditTargetText", () => {
  it("joins the target and detail that are set", () => {
    expect(auditTargetText({ targetId: "abc", detail: "Bob" })).toBe("abc · Bob");
    expect(auditTargetText({ targetId: null, detail: "invite" })).toBe("invite");
    expect(auditTargetText({ targetId: "abc", detail: "" })).toBe("abc");
    expect(auditTargetText({ targetId: null, detail: null })).toBeNull();
  });
});
