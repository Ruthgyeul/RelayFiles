import { describe, expect, it } from "vitest";
import type { NodeItem } from "@/contracts/nodes";
import { buildNodeMenu, type NodeActions } from "./node-menu";

const settings = { visibility: "inherit", expiry: "Never", expAt: null, burn: false, downloadLimit: null, hasPassword: false, access: "both", note: "", dlPaused: false } as const;
const noop = () => undefined;
const all: Required<NodeActions> = Object.fromEntries(
  ["open", "preview", "download", "downloadZip", "share", "tags", "directLink", "newLink", "activity", "settings", "togglePause", "rename", "copy", "move", "delete", "properties"].map((key) => [key, noop]),
) as Required<NodeActions>;

const folder: Pick<NodeItem, "type" | "kind" | "settings"> = { type: "folder", kind: null, settings };
const video: Pick<NodeItem, "type" | "kind" | "settings"> = { type: "file", kind: "video", settings };

const labels = (entries: ReturnType<typeof buildNodeMenu>) => entries.map((entry) => `${entry.separator ? "| " : ""}${entry.label}`);

describe("buildNodeMenu (design nodeMenu)", () => {
  it("builds the folder menu in four groups", () => {
    expect(labels(buildNodeMenu(folder, false, false, all))).toEqual([
      "Open",
      "Download",
      "| Share",
      "Tags",
      "Direct link",
      "New link",
      "Link activity",
      "Sharing & access",
      "| Rename",
      "Copy",
      "Move",
      "Delete",
      "| Properties",
    ]);
  });

  it("builds the file menu with preview, zip and the admin pause toggle", () => {
    const entries = buildNodeMenu({ ...video, settings: { ...settings, dlPaused: true } }, false, true, all);
    expect(labels(entries).slice(0, 3)).toEqual(["Preview", "Download", "Download as zip"]);
    expect(labels(entries)).toContain("Expiry & access");
    expect(labels(entries)).toContain("Resume downloads");
    expect(entries.find((entry) => entry.label === "Delete")?.danger).toBe(true);
  });

  it("hides root-only exclusions, other-file preview and missing actions", () => {
    expect(labels(buildNodeMenu(folder, true, false, all))).not.toContain("Open");
    expect(labels(buildNodeMenu(folder, true, false, all))).not.toContain("Delete");
    expect(labels(buildNodeMenu({ ...video, kind: "other" }, false, false, all))).not.toContain("Preview");
    expect(labels(buildNodeMenu(folder, false, false, { open: noop, properties: noop }))).toEqual(["Open", "| Properties"]);
  });
});
