/**
 * Tag rules: parsing a "#tag" query, matching items that carry every tag, and normalizing new tags.
 * Tags are lowercase words; the search box switches to tag mode when it starts with "#".
 */

/** Longest tag the tag editor accepts. */
export const MAX_TAG_LENGTH = 24;

/** "#Movie #2024, #work" → ["movie", "2024", "work"]. */
export function parseTags(query: string): string[] {
  return (query.match(/#[^\s#,]+/g) ?? []).map((tag) => tag.slice(1).toLowerCase());
}

/** True when every wanted tag is on the item (and at least one tag is wanted). */
export function hasAllTags(tags: readonly string[], wanted: readonly string[]): boolean {
  return wanted.length > 0 && wanted.every((tag) => tags.includes(tag));
}

/** Tag typed by the user → stored form: trimmed, lowercase, spaces become "-", no "#", max 24 chars. */
export function normalizeTag(input: string): string {
  return input
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[#,]/g, "")
    .slice(0, MAX_TAG_LENGTH);
}

/**
 * The search query after clicking a tag chip: a tag search gets the tag added (unless it is
 * already there), any other text is replaced by a search for that tag.
 */
export function withTagQuery(query: string, tag: string): string {
  const trimmed = query.trim();
  if (!trimmed.startsWith("#")) return `#${tag}`;
  return parseTags(trimmed).includes(tag) ? trimmed : `${trimmed} #${tag}`;
}
