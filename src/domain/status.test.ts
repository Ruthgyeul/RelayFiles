import { describe, expect, it } from "vitest";
import { levelOfHealth, STATUS_TITLE } from "./status";

describe("status levels", () => {
  it("maps health to the design wording", () => {
    expect(STATUS_TITLE[levelOfHealth("ok")]).toBe("All systems operational");
    expect(STATUS_TITLE[levelOfHealth("degraded")]).toBe("Degraded performance");
    expect(STATUS_TITLE[levelOfHealth("down")]).toBe("Can't reach the server");
    expect(levelOfHealth(null)).toBe("down");
  });
});
