import { parseTags } from "./tags";

/**
 * Global search rules (design `gs*`): an empty query lists recent files, "#tag1 #tag2" finds
 * items with every tag, anything else matches names anywhere in the account.
 */
export type SearchQuery = { mode: "recent" } | { mode: "tags"; tags: string[] } | { mode: "name"; text: string };

export function parseSearchQuery(raw: string): SearchQuery {
  const text = raw.trim().toLowerCase();
  if (!text) return { mode: "recent" };
  if (text.startsWith("#")) {
    const tags = parseTags(text);
    return tags.length ? { mode: "tags", tags } : { mode: "recent" };
  }
  return { mode: "name", text };
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

/** "3 results with #movie + #2024", or the hint shown before typing. */
export function searchHeading(query: SearchQuery, count: number): string {
  if (query.mode === "recent") return "Recent files · type #tag (or #tag1 #tag2) to search tags";
  const results = `${count} ${count === 1 ? "result" : "results"}`;
  return query.mode === "tags" ? `${results} with ${query.tags.map((tag) => `#${tag}`).join(" + ")}` : results;
}

/** Moves the highlighted row with ↑ ↓, staying inside the list. */
export function moveHighlight(index: number, key: "ArrowUp" | "ArrowDown", count: number): number {
  if (count === 0) return 0;
  return key === "ArrowDown" ? Math.min(count - 1, index + 1) : Math.max(0, index - 1);
}
