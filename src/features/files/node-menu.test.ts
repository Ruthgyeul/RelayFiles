import { describe, expect, it } from "vitest";
import type { NodeItem } from "@/contracts/nodes";
import { buildNodeMenu, type NodeActions } from "./node-menu";

const settings = { visibility: "inherit", expiry: "Never", expAt: null, burn: false, downloadLimit: null, hasPassword: false, access: "both", note: "", dlPaused: false } as const;
const noop = () => undefined;
const all: Required<NodeActions> = Object.fromEntries(
  ["open", "preview", "download", "downloadZip", "toggleFavorite", "share", "uploadLinks", "tags", "directLink", "newLink", "activity", "settings", "togglePause", "rescan", "rename", "copy", "move", "delete", "renumber", "duplicates", "properties"].map((key) => [key, noop]),
) as Required<NodeActions>;

const folder: Pick<NodeItem, "type" | "kind" | "settings" | "favorite" | "scan"> = { type: "folder", kind: null, settings };
const video: Pick<NodeItem, "type" | "kind" | "settings" | "favorite" | "scan"> = { type: "file", kind: "video", settings };

const labels = (entries: ReturnType<typeof buildNodeMenu>) => entries.map((entry) => `${entry.separator ? "| " : ""}${entry.label}`);

describe("buildNodeMenu (design nodeMenu)", () => {
  it("builds the folder menu in its groups, folder tools before properties", () => {
    expect(labels(buildNodeMenu(folder, false, false, all))).toEqual([
      "Open",
      "Download",
      "Add to favorites",
      "| Share",
      "Upload links",
      "Tags",
      "Direct link",
      "New link",
      "Link activity",
      "Sharing & access",
      "| Rename",
      "Copy",
      "Move",
      "Delete",
      "| Renumber files",
      "Find duplicates",
      "| Properties",
    ]);
  });

  it("builds the file menu with preview, zip and the admin pause toggle", () => {
    const entries = buildNodeMenu({ ...video, settings: { ...settings, dlPaused: true } }, false, true, all);
    expect(labels(entries).slice(0, 3)).toEqual(["Preview", "Download", "Download as zip"]);
    expect(labels(entries)).toContain("Expiry & access");
    expect(labels(entries)).toContain("Resume downloads");
    expect(entries.find((entry) => entry.label === "Delete")?.danger).toBe(true);
    expect(labels(entries)).not.toContain("Renumber files");
  });

  it("offers a new virus scan only for files whose scan failed", () => {
    const names = (item: typeof video) => buildNodeMenu(item, false, false, all).map((entry) => entry.label);
    expect(names({ ...video, scan: "failed" })).toContain("Scan again");
    expect(names({ ...video, scan: "pending" })).not.toContain("Scan again");
    expect(names(video)).not.toContain("Scan again");
  });

  it("offers adding to or removing from Favorites, never for the root", () => {
    expect(labels(buildNodeMenu(video, false, false, all))).toContain("Add to favorites");
    expect(labels(buildNodeMenu({ ...video, favorite: true }, false, false, all))).toContain("Remove from favorites");
    expect(labels(buildNodeMenu(folder, true, false, all))).not.toContain("Add to favorites");
  });

  it("hides root-only exclusions, other-file preview and missing actions", () => {
    expect(labels(buildNodeMenu(folder, true, false, all))).not.toContain("Open");
    expect(labels(buildNodeMenu(folder, true, false, all))).not.toContain("Delete");
    expect(labels(buildNodeMenu({ ...video, kind: "other" }, false, false, all))).not.toContain("Preview");
    expect(labels(buildNodeMenu(folder, false, false, { open: noop, properties: noop }))).toEqual(["Open", "| Properties"]);
  });
});
