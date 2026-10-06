import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ICONS, isIconName } from "./registry";

const design = readFileSync("docs/design/Relay_App.dc.html", "utf8");
const designIcons = [...new Set([...design.matchAll(/ph-([a-z0-9-]+)/g)].map((m) => m[1]!))].filter((n) => n !== "bold" && n !== "fill");

describe("icon registry", () => {
  it("contains every icon used by the design prototype", () => {
    const missing = designIcons.filter((name) => !isIconName(name));
    expect(missing).toEqual([]);
    expect(designIcons.length).toBeGreaterThanOrEqual(100);
  });

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
