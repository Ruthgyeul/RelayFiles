import { describe, expect, it } from "vitest";
import { ICONS, isIconName } from "./registry";

describe("icon registry", () => {
  it("maps every name to a Phosphor component", () => {
    for (const [name, component] of Object.entries(ICONS)) {
      expect(component, name).toBeTruthy();
      expect(["function", "object"]).toContain(typeof component);
    }
  });

  it("rejects unknown names", () => {
    expect(isIconName("not-an-icon")).toBe(false);
  });
});
