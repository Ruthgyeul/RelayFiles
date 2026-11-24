import { parseTags } from "./tags";
import { plural } from "./format";

/** Kinds a query can ask for with `type:` (the File Manager filters, "all" aside). */
export const SEARCH_KINDS = ["folder", "video", "audio", "image", "other"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** Units of `newer:` / `older:` ages: 30d, 2w, 6m, 1y. */
const AGE_UNIT_DAYS = { d: 1, w: 7, m: 30, y: 365 } as const;
const AGE_PATTERN = /^(newer|older):(\d{1,4})([dwmy])$/;
const TYPE_PREFIX = "type:";

/**
 * Global search rules (design `gs*`): an empty query lists recent files; otherwise every part
 * must match. "#tag" asks for a tag, "type:video" for a kind (several: any of them),
 * "newer:30d" / "older:1y" for the date modified (date added without one), and the other words
 * for a name containing them.
 */
export type SearchQuery =
  | { mode: "recent" }
  | { mode: "search"; text: string; tags: string[]; kinds: SearchKind[]; newerThanDays: number | null; olderThanDays: number | null };

const isKind = (value: string): value is SearchKind => (SEARCH_KINDS as readonly string[]).includes(value);

export function parseSearchQuery(raw: string): SearchQuery {
  const words: string[] = [];
  const tags: string[] = [];
  const kinds: SearchKind[] = [];
  let newerThanDays: number | null = null;
  let olderThanDays: number | null = null;
  for (const token of raw.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
    const age = AGE_PATTERN.exec(token);
    const kind = token.startsWith(TYPE_PREFIX) ? token.slice(TYPE_PREFIX.length) : null;
    if (token.startsWith("#")) tags.push(...parseTags(token));
    else if (kind !== null && isKind(kind)) {
      if (!kinds.includes(kind)) kinds.push(kind);
    } else if (age) {
      const days = Number(age[2]) * AGE_UNIT_DAYS[age[3] as keyof typeof AGE_UNIT_DAYS];
      if (age[1] === "newer") newerThanDays = days;
      else olderThanDays = days;
    } else words.push(token);
  }
  const text = words.join(" ");
  if (!text && tags.length === 0 && kinds.length === 0 && newerThanDays === null && olderThanDays === null) return { mode: "recent" };
  return { mode: "search", text, tags: [...new Set(tags)], kinds, newerThanDays, olderThanDays };
}

/** The query written back in one form ("#a type:image newer:30d trip"): what a saved search stores. */
export function formatSearchQuery(query: SearchQuery): string {
  if (query.mode === "recent") return "";
  return [
    ...query.tags.map((tag) => `#${tag}`),
    ...query.kinds.map((kind) => `${TYPE_PREFIX}${kind}`),
    ...(query.newerThanDays === null ? [] : [`newer:${query.newerThanDays}d`]),
    ...(query.olderThanDays === null ? [] : [`older:${query.olderThanDays}d`]),
    ...(query.text ? [query.text] : []),
  ].join(" ");
}

/** Best name matches first: earlier match, then folders before files, then by name. */
export function rankByName<T extends { name: string; type: "folder" | "file" }>(items: readonly T[], text: string): T[] {
  const needle = text.toLowerCase();
  return items
    .map((item) => ({ item, at: item.name.toLowerCase().indexOf(needle) }))
    .filter(({ at }) => at >= 0)
    .sort((a, b) => a.at - b.at || Number(a.item.type === "file") - Number(b.item.type === "file") || a.item.name.localeCompare(b.item.name))
    .map(({ item }) => item);
}

const KIND_TEXT: Record<SearchKind, string> = { folder: "folders", video: "videos", audio: "audio", image: "images", other: "other files" };

/** "3 results with #movie + #2024 · videos · modified in the last 30 days", or the hint shown before typing. */
export function searchHeading(query: SearchQuery, count: number): string {
  if (query.mode === "recent") return "Recent files · type #tag (or #tag1 #tag2) to search tags";
  const parts = [query.tags.length ? `${plural(count, "result")} with ${query.tags.map((tag) => `#${tag}`).join(" + ")}` : plural(count, "result")];
  if (query.kinds.length) parts.push(query.kinds.map((kind) => KIND_TEXT[kind]).join(" or "));
  if (query.newerThanDays !== null) parts.push(`modified in the last ${plural(query.newerThanDays, "day")}`);
  if (query.olderThanDays !== null) parts.push(`modified over ${plural(query.olderThanDays, "day")} ago`);
  return parts.join(" · ");
}

/** Moves the highlighted row with ↑ ↓, staying inside the list. */
export function moveHighlight(index: number, key: "ArrowUp" | "ArrowDown", count: number): number {
  if (count === 0) return 0;
  return key === "ArrowDown" ? Math.min(count - 1, index + 1) : Math.max(0, index - 1);
}
