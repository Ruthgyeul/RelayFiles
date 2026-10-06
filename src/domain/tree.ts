/**
 * File tree rules from the design prototype: sorting (`sortNodes`), type filters, path
 * crumbs, inherited visibility (`effVis`) and the setting tags shown under items (`tags`).
 */
import { formatLeft } from "./format";

export type NodeKind = "video" | "audio" | "image" | "other";
export type NodeType = "folder" | "file";
export type Visibility = "inherit" | "private" | "public";

/** The fields these rules need; API items satisfy it structurally. */
export interface SortableNode {
  type: NodeType;
  name: string;
  kind: NodeKind | null;
  /** Bytes; folders carry the total size of their contents. */
  size: number;
  createdAt: number;
}

export const SORT_KEYS = ["name", "name-desc", "date", "date-asc", "size", "size-asc", "type"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** Menu labels ("SORT BY") and the short toolbar labels, as in the design. */
export const SORT_OPTION_LABEL: Record<SortKey, string> = {
  name: "Name A → Z",
  "name-desc": "Name Z → A",
  date: "Newest first",
  "date-asc": "Oldest first",
  size: "Largest first",
  "size-asc": "Smallest first",
  type: "Type",
};
export const SORT_SHORT_LABEL: Record<SortKey, string> = {
  name: "Name A–Z",
  "name-desc": "Name Z–A",
  date: "Newest",
  "date-asc": "Oldest",
  size: "Largest",
  "size-asc": "Smallest",
  type: "Type",
};

const KIND_ORDER: Record<NodeKind, number> = { video: 0, audio: 1, image: 2, other: 3 };
const UNKNOWN_KIND_ORDER = 9;
const byName = (a: SortableNode, b: SortableNode) => a.name.localeCompare(b.name, undefined, { numeric: true });

const COMPARE: Record<SortKey, (a: SortableNode, b: SortableNode) => number> = {
  name: byName,
  "name-desc": (a, b) => byName(b, a),
  date: (a, b) => b.createdAt - a.createdAt,
  "date-asc": (a, b) => a.createdAt - b.createdAt,
  size: (a, b) => b.size - a.size,
  "size-asc": (a, b) => a.size - b.size,
  type: (a, b) => (a.kind ? KIND_ORDER[a.kind] : UNKNOWN_KIND_ORDER) - (b.kind ? KIND_ORDER[b.kind] : UNKNOWN_KIND_ORDER) || byName(a, b),
};

/** Folders first, then the chosen order. Returns a new array. */
export function sortNodes<T extends SortableNode>(list: readonly T[], key: SortKey): T[] {
  const compare = COMPARE[key];
  return [...list].sort((a, b) => (a.type === b.type ? 0 : a.type === "folder" ? -1 : 1) || compare(a, b));
}

export const FILTER_KEYS = ["all", "folder", "video", "audio", "image", "other"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export function matchesFilter(node: Pick<SortableNode, "type" | "kind">, filter: FilterKey): boolean {
  if (filter === "all") return true;
  if (filter === "folder") return node.type === "folder";
  return node.type === "file" && node.kind === filter;
}

export interface Crumb {
  id: string;
  name: string;
}

export type CrumbSlot = { kind: "crumb"; crumb: Crumb; index: number } | { kind: "gap"; hidden: Crumb[] };

/** Crumbs shown at most: 3 below 720px, 6 otherwise (design `MAX`). */
export const CRUMB_LIMIT = { mobile: 3, desktop: 6 } as const;

/** Collapses a long path to [root, …, last max−2] like the design; the gap lists the hidden folders. */
export function collapseCrumbs(chain: readonly Crumb[], max: number): CrumbSlot[] {
  const slots: CrumbSlot[] = chain.map((crumb, index) => ({ kind: "crumb", crumb, index }));
  if (chain.length <= max) return slots;
  const tail = max - 2;
  return [slots[0]!, { kind: "gap", hidden: chain.slice(1, chain.length - tail) }, ...slots.slice(chain.length - tail)];
}

/** "/Videos/2024" for the path bar (the root is "/"). */
export function pathString(chain: readonly Crumb[]): string {
  return `/${chain
    .slice(1)
    .map((crumb) => crumb.name)
    .join("/")}`;
}

/** Visibility that applies: the nearest explicit setting from the node up to the root; private by default. */
export function effectiveVisibility(chainFromNode: readonly Visibility[]): "private" | "public" {
  for (const visibility of chainFromNode) if (visibility !== "inherit") return visibility;
  return "private";
}

export interface ShareSettings {
  visibility: Visibility;
  /** Expiry choice label ("Never", "7 days", …). */
  expiry: string;
  /** Epoch ms when the item is deleted, if it has an expiry. */
  expAt: number | null;
  burn: boolean;
  downloadLimit: number | null;
  hasPassword: boolean;
  access: "both" | "stream";
}

export type SettingTagIcon = "timer" | "fire" | "prohibit" | "download-simple" | "lock-simple" | "play-circle" | "globe-simple" | "lock-key";

export interface SettingTag {
  icon: SettingTagIcon;
  label: string;
}

/**
 * Tags describing an item's share settings (design `tags`). A private item is only tagged
 * "Private" when its parent is public, because private is the default.
 */
export function settingTags(settings: ShareSettings, downloads: number, parentVisibility: "private" | "public" | null, now: number): SettingTag[] {
  const tags: SettingTag[] = [];
  if (settings.expiry !== "Never") {
    tags.push({ icon: "timer", label: settings.expAt ? `Expires in ${formatLeft(settings.expAt - now)}` : `Deletes in ${settings.expiry}` });
  }
  if (settings.burn) tags.push({ icon: "fire", label: "Deletes after 1 download" });
  if (settings.downloadLimit) {
    tags.push(
      downloads >= settings.downloadLimit
        ? { icon: "prohibit", label: `Link blocked · ${downloads} / ${settings.downloadLimit} downloads` }
        : { icon: "download-simple", label: `${downloads} / ${settings.downloadLimit} downloads` },
    );
  }
  if (settings.hasPassword) tags.push({ icon: "lock-simple", label: "Password" });
  if (settings.access === "stream") tags.push({ icon: "play-circle", label: "Stream only" });
  if (settings.visibility === "public") tags.unshift({ icon: "globe-simple", label: "Public" });
  else if (settings.visibility === "private" && parentVisibility === "public") tags.unshift({ icon: "lock-key", label: "Private" });
  return tags;
}

/** Visibility tag in the folder header: "Public", "Public · inherited", "Private", "Private · inherited". */
export function visibilityTag(own: Visibility, effective: "private" | "public", isRoot: boolean): SettingTag {
  if (effective === "public") return { icon: "globe-simple", label: own === "public" ? "Public" : "Public · inherited" };
  return { icon: "lock-key", label: own === "private" || isRoot ? "Private" : "Private · inherited" };
}

/** Title of the empty list state (design `emptyTitle`). */
export function emptyTitle({ tagMode, wanted, query, filter }: { tagMode: boolean; wanted: readonly string[]; query: string; filter: FilterKey }): string {
  if (tagMode) {
    if (wanted.length === 0) return "Type a tag after #";
    return `Nothing has ${wanted.length > 1 ? "all of " : ""}${wanted.map((tag) => `#${tag}`).join(" ")}`;
  }
  if (query) return "No matches";
  if (filter !== "all") return "Nothing of this type here";
  return "This folder is empty";
}

/** "1 item" / "3 items". */
export function itemCount(count: number): string {
  return `${count} ${count === 1 ? "item" : "items"}`;
}
