import { describe, expect, it } from "vitest";
import { activeNavItem, navItemsFor } from "./nav";

describe("navigation", () => {
  it("shows admin sections only to admins, in the design order", () => {
    expect(navItemsFor(false).map((item) => item.label)).toEqual(["Home", "File Manager", "Status", "Settings"]);
    expect(navItemsFor(true).map((item) => item.label)).toEqual(["Home", "File Manager", "Accounts", "Server", "Status", "Settings"]);
  });

  it("finds the section for a path", () => {
    expect(activeNavItem("/")?.title).toBe("Home");
    expect(activeNavItem("/files/abc")?.label).toBe("File Manager");
    expect(activeNavItem("/settings")?.title).toBe("My Profile");
    expect(activeNavItem("/admin/server")?.title).toBe("Server");
    expect(activeNavItem("/filesystem")).toBeUndefined();
  });
});
