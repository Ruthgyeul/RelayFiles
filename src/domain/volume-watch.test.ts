import { describe, expect, it } from "vitest";
import { watchedStatus } from "./volume-watch";

describe("watchedStatus", () => {
  it("takes a volume offline when its marker is gone or names another volume", () => {
    expect(watchedStatus("ACTIVE", "offline")).toBe("OFFLINE");
    expect(watchedStatus("ACTIVE", "mismatch")).toBe("OFFLINE");
    expect(watchedStatus("ACTIVE", "online")).toBeNull();
    // A layout migration is pending: storage:migrate handles it, not the watch.
    expect(watchedStatus("ACTIVE", "layout-mismatch")).toBeNull();
  });

  it("brings an offline volume back once its marker is readable", () => {
    expect(watchedStatus("OFFLINE", "online")).toBe("ACTIVE");
    expect(watchedStatus("OFFLINE", "offline")).toBeNull();
  });

  it("leaves volumes being migrated alone", () => {
    expect(watchedStatus("READONLY", "offline")).toBeNull();
    expect(watchedStatus("DRAINING", "offline")).toBeNull();
  });
});
