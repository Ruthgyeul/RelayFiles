import { describe, expect, it } from "vitest";
import { buildMenu, FAVORITE_MENU, NODE_MENU, SELECTION_TOOLBAR, toolbarButtons, type ActionHandlers, type ActionId, type ActionItem } from "./item-actions";

const settings = { visibility: "inherit", expiry: "Never", expAt: null, burn: false, downloadLimit: null, dailyCapGb: null, hasPassword: false, access: "both", note: "", dlPaused: false } as const;
const noop = () => undefined;
const ids: ActionId[] = ["open", "preview", "download", "downloadZip", "toggleFavorite", "showInFolder", "moveInFavorites", "share", "uploadLinks", "tags", "directLink", "newLink", "activity", "settings", "togglePause", "rescan", "rename", "copy", "move", "delete", "renumber", "duplicates", "versions", "properties"];
const all: Required<ActionHandlers> = Object.fromEntries(ids.map((key) => [key, noop])) as Required<ActionHandlers>;
const buildNodeMenu = (item: ActionItem, isRoot: boolean, isAdmin: boolean, actions: ActionHandlers) => buildMenu(NODE_MENU, item, { isRoot, isAdmin }, actions);

const folder: ActionItem = { type: "folder", kind: null, name: "Trips", settings };
const video: ActionItem = { type: "file", kind: "video", name: "trip.mp4", settings };

const labels = (entries: ReturnType<typeof buildNodeMenu>) => entries.map((entry) => `${entry.separator ? "| " : ""}${entry.label}`);

describe("NODE_MENU (design nodeMenu)", () => {
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

  it("offers the version history for files only", () => {
    const entries = labels(buildNodeMenu(video, false, false, all));
    expect(entries.slice(entries.indexOf("| Version history"), entries.indexOf("| Version history") + 2)).toEqual(["| Version history", "| Properties"]);
    expect(labels(buildNodeMenu(folder, false, false, all))).not.toContain("Version history");
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
    expect(labels(buildNodeMenu({ ...video, kind: "other", name: "backup.zip" }, false, false, all))).not.toContain("Preview");
    expect(labels(buildNodeMenu({ ...video, kind: "other", name: "report.pdf" }, false, false, all))).toContain("Preview");
    expect(labels(buildNodeMenu(folder, false, false, { open: noop, properties: noop }))).toEqual(["Open", "| Properties"]);
  });
});

describe("FAVORITE_MENU", () => {
  const favoriteMenu = (item: ActionItem) => labels(buildMenu(FAVORITE_MENU, { ...item, favorite: true }, { isRoot: false, isAdmin: false }, all));

  it("acts on the item where it is, in the design's groups", () => {
    expect(favoriteMenu(folder)).toEqual(["Open", "Download", "Show in folder", "| Move in favorites", "Remove from favorites", "| Share", "Tags", "Link activity", "| Rename", "Delete", "| Properties"]);
    expect(favoriteMenu(video)).toEqual(["Preview", "Download", "Show in folder", "| Move in favorites", "Remove from favorites", "| Tags", "Link activity", "| Rename", "Delete", "| Properties"]);
  });

  it("follows the same preview rule as the File Manager", () => {
    expect(favoriteMenu({ ...video, kind: "other", name: "backup.zip" })).not.toContain("Preview");
  });
});

describe("SELECTION_TOOLBAR", () => {
  it("uses the toolbar's short labels and tooltips", () => {
    expect(toolbarButtons(SELECTION_TOOLBAR).map(({ label, title }) => (label === title ? label : `${label} (${title})`))).toEqual([
      "Download",
      "Zip (Download as zip)",
      "Tags",
      "Favorite (Add to favorites)",
      "Copy",
      "Move",
      "Rename (Rename the selected items)",
      "Delete",
    ]);
    expect(toolbarButtons(["delete"])[0]?.danger).toBe(true);
  });

  it("refuses an action without a toolbar look", () => {
    expect(() => toolbarButtons(["properties"])).toThrow();
  });
});
