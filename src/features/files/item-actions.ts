import type { NodeItem } from "@/contracts/nodes";
import { hasPreview } from "@/domain/file-format";
import type { IconName } from "@/shared/ui/icon/Icon";
import type { MenuEntry } from "./ActionMenu";

/** What an action is shown for: the item, and whether it is the account root and the viewer an admin. */
export type ActionItem = Pick<NodeItem, "type" | "kind" | "name" | "settings" | "favorite" | "scan">;
export interface ActionContext {
  isRoot: boolean;
  isAdmin: boolean;
}

/**
 * Every action on a file or folder, in one place: its label and icon, when it applies and how
 * it looks in the selection toolbar. Menus and the toolbar pick from this list by id, so a new
 * action is added here once (and given a handler where it is offered).
 */
const ACTIONS = {
  open: { label: "Open", icon: "folder-open", when: (item, ctx) => item.type === "folder" && !ctx.isRoot },
  preview: { label: "Preview", icon: "eye", when: (item) => item.type === "file" && hasPreview(item.name, item.kind) },
  download: { label: "Download", icon: "download-simple", bulk: {} },
  downloadZip: { label: "Download as zip", icon: "file-zip", when: (item) => item.type === "file", bulk: { label: "Zip", title: "Download as zip" } },
  /** Adds the item to Favorites, or takes it out (the item stays where it is). */
  toggleFavorite: { label: (item) => (item.favorite ? "Remove from favorites" : "Add to favorites"), icon: "star", when: (_, ctx) => !ctx.isRoot, bulk: { label: "Favorite", title: "Add to favorites" } },
  showInFolder: { label: "Show in folder", icon: "arrow-up-right" },
  moveInFavorites: { label: "Move in favorites", icon: "arrow-bend-up-right" },
  share: { label: "Share", icon: "share-network", when: (item) => item.type === "folder" },
  uploadLinks: { label: "Upload links", icon: "tray-arrow-down", when: (item) => item.type === "folder" },
  tags: { label: "Tags", icon: "tag", bulk: {} },
  directLink: { label: "Direct link", icon: "link-simple" },
  newLink: { label: "New link", icon: "arrows-clockwise" },
  activity: { label: "Link activity", icon: "chart-line-up" },
  settings: { label: (_, ctx) => (ctx.isAdmin ? "Expiry & access" : "Sharing & access"), icon: "sliders-horizontal" },
  togglePause: {
    label: (item) => (item.settings.dlPaused ? "Resume downloads" : "Pause downloads"),
    icon: (item) => (item.settings.dlPaused ? "play-circle" : "pause-circle"),
    when: (_, ctx) => ctx.isAdmin,
  },
  rename: { label: "Rename", icon: "pencil-simple", bulk: { title: "Rename the selected items" } },
  copy: { label: "Copy", icon: "copy", when: (_, ctx) => !ctx.isRoot, bulk: {} },
  move: { label: "Move", icon: "arrow-bend-up-right", when: (_, ctx) => !ctx.isRoot, bulk: {} },
  delete: { label: "Delete", icon: "trash", danger: true, when: (_, ctx) => !ctx.isRoot, bulk: {} },
  /** Folders: rename the files inside to 01, 02, 03, … */
  renumber: { label: "Renumber files", icon: "list-numbers", when: (item) => item.type === "folder" },
  /** Folders: files with the same content. */
  duplicates: { label: "Find duplicates", icon: "files", when: (item) => item.type === "folder" },
  /** Folders inside the root: move old files to Recently deleted every day. */
  autoClean: { label: "Auto clean", icon: "broom", when: (item, ctx) => item.type === "folder" && !ctx.isRoot },
  /** Files: earlier versions kept when an upload replaced the file. */
  versions: { label: "Version history", icon: "clock-counter-clockwise", when: (item) => item.type === "file" },
  /** A file whose virus scan failed: queue a new one. */
  rescan: { label: "Scan again", icon: "shield-check", when: (item) => item.scan === "failed" },
  properties: { label: "Properties", icon: "info" },
} satisfies Record<string, ActionDef>;

interface ActionDef {
  label: string | ((item: ActionItem, ctx: ActionContext) => string);
  icon: IconName | ((item: ActionItem, ctx: ActionContext) => IconName);
  danger?: true;
  /** Shown only when this holds (always when missing). */
  when?: (item: ActionItem, ctx: ActionContext) => boolean;
  /** Offered in the selection toolbar, with a shorter label or a tooltip there. */
  bulk?: { label?: string; title?: string };
}

export type ActionId = keyof typeof ACTIONS;
/** Handlers by action; a missing one hides its entry. */
export type ActionHandlers = Partial<Record<ActionId, () => void>>;

/** The File Manager's item menu in the design's groups: open/download, sharing, file operations, folder tools, properties. */
export const NODE_MENU: readonly (readonly ActionId[])[] = [
  ["open", "preview", "download", "downloadZip", "toggleFavorite"],
  ["share", "uploadLinks", "tags", "directLink", "newLink", "activity", "settings", "togglePause"],
  ["rename", "copy", "move", "delete"],
  ["renumber", "duplicates", "autoClean", "versions", "rescan"],
  ["properties"],
];

/** A favorite's menu: it acts on the item itself, where it is. */
export const FAVORITE_MENU: readonly (readonly ActionId[])[] = [
  ["open", "preview", "download", "showInFolder"],
  ["moveInFavorites", "toggleFavorite"],
  ["share", "tags", "activity"],
  ["rename", "delete"],
  ["properties"],
];

/** The selection toolbar of the File Manager, in order. */
export const SELECTION_TOOLBAR = ["download", "downloadZip", "tags", "toggleFavorite", "copy", "move", "rename", "delete"] as const satisfies readonly ActionId[];

const resolve = <T>(value: T | ((item: ActionItem, ctx: ActionContext) => T), item: ActionItem, ctx: ActionContext): T => (typeof value === "function" ? (value as (item: ActionItem, ctx: ActionContext) => T)(item, ctx) : value);

/** A menu from `layout`: entries that apply and have a handler, a separator above each non-empty group. */
export function buildMenu(layout: readonly (readonly ActionId[])[], item: ActionItem, ctx: ActionContext, handlers: ActionHandlers): MenuEntry[] {
  const entries: MenuEntry[] = [];
  for (const group of layout) {
    let first = true;
    for (const id of group) {
      const def: ActionDef = ACTIONS[id];
      const run = handlers[id];
      if (!run || (def.when && !def.when(item, ctx))) continue;
      entries.push({ label: resolve(def.label, item, ctx), icon: resolve(def.icon, item, ctx), onSelect: run, danger: def.danger === true, separator: entries.length > 0 && first });
      first = false;
    }
  }
  return entries;
}

export interface ToolbarAction<I extends ActionId = ActionId> {
  id: I;
  label: string;
  title: string;
  icon: IconName;
  danger: boolean;
}

/** The toolbar buttons for `ids`: actions with a `bulk` look, whose label there and icon don't depend on an item. */
export function toolbarButtons<I extends ActionId>(ids: readonly I[]): ToolbarAction<I>[] {
  return ids.map((id) => {
    const def: ActionDef = ACTIONS[id];
    const label = def.bulk?.label ?? def.label;
    if (!def.bulk || typeof label !== "string" || typeof def.icon !== "string") throw new Error(`Action ${id} has no toolbar look.`);
    return { id, label, title: def.bulk.title ?? label, icon: def.icon, danger: def.danger === true };
  });
}
