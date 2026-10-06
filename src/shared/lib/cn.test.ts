import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins truthy class names", () => {
    expect(cn("a", false, undefined, "b", { c: true, d: false })).toBe("a b c");
  });

  it("lets later Tailwind utilities override conflicting earlier ones", () => {
    expect(cn("h-8 px-3", "px-4")).toBe("h-8 px-4");
    expect(cn("bg-btn", "bg-accent")).toBe("bg-accent");
  });
});
