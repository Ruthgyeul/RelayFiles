import { describe, expect, it } from "vitest";
import { menuPlace } from "./menu";

const viewport = { width: 1280, height: 800 };

describe("menuPlace (design)", () => {
  it("opens below when there is room", () => {
    expect(menuPlace({ top: 100, bottom: 130, right: 1200 }, 5, viewport)).toEqual({ top: "134px", right: "80px", maxHeight: "658px" });
  });

  it("opens above near the bottom of the screen", () => {
    expect(menuPlace({ top: 700, bottom: 730, right: 1200 }, 5, viewport)).toEqual({ bottom: "104px", right: "80px", maxHeight: "688px" });
  });

  it("pins and scrolls when it fits neither way", () => {
    expect(menuPlace({ top: 300, bottom: 330, right: 1279 }, 20, { width: 1280, height: 600 })).toEqual({ top: "8px", right: "8px", maxHeight: "584px" });
  });

  it("uses taller items on mobile", () => {
    // 8 items: 412px estimated on mobile (44px rows), 348px on desktop (36px rows); 408px below.
    const rect = { top: 450, bottom: 480, right: 350 };
    expect(menuPlace(rect, 8, { width: 360, height: 900 }).bottom).toBe("454px");
    expect(menuPlace(rect, 8, { width: 1024, height: 900 }).top).toBe("484px");
  });
});
