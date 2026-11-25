import "server-only";
import { MS } from "@/config/policy";
import type { AllFilesCounts, AllFilesPage, AllFilesQuery } from "@/contracts/all-files";
import { allFilesOrder, allFilesSortValue, decodeAllFilesCursor, encodeAllFilesCursor, type AllFilesSort } from "@/domain/all-files";
import { parseSearchQuery, type SearchKind } from "@/domain/search";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { countFilesByKind, filesPage, type FilesFilter } from "../repositories/node.repo";
import { withPaths } from "./node.service";

type FileKind = Exclude<SearchKind, "folder">;

/**
 * The filters of a page: the type chip and the search box together (`q` reads like global
 * search). Asking for folders only (`type:folder`) lists nothing, as no folder is ever listed.
 */
function filterOf(query: Pick<AllFilesQuery, "kind" | "q">, now: Date): FilesFilter | null {
  const parsed = parseSearchQuery(query.q);
  const daysAgo = (days: number | null) => (days === null ? null : new Date(now.getTime() - days * MS.day));
  const chip: FileKind[] = query.kind === "all" ? [] : [query.kind];
  if (parsed.mode === "recent") return { text: "", tags: [], kinds: chip, newerThan: null, olderThan: null };
  const typed = parsed.kinds.filter((kind): kind is FileKind => kind !== "folder");
  if (parsed.kinds.length > 0 && typed.length === 0) return null;
  // Both the chip and type: in the box: only kinds in both.
  const kinds = chip.length && typed.length ? chip.filter((kind) => typed.includes(kind)) : [...chip, ...typed];
  if ((chip.length || typed.length) && kinds.length === 0) return null;
  return { text: parsed.text, tags: parsed.tags, kinds, newerThan: daysAgo(parsed.newerThanDays), olderThan: daysAgo(parsed.olderThanDays) };
}

/** A cursor's sort value as the column holds it. */
function afterOf(cursor: string | undefined, sort: AllFilesSort) {
  if (cursor === undefined) return null;
  const position = decodeAllFilesCursor(cursor, sort);
  if (!position) throw new ApiError("BAD_REQUEST", "Unknown cursor.");
  const { column } = allFilesOrder(sort);
  const value = column === "createdAt" ? new Date(Number(position.value)) : column === "size" ? BigInt(position.value) : position.value;
  return { value, id: position.id };
}

async function countsOf(accountId: string, filter: FilesFilter | null): Promise<AllFilesCounts> {
  const kinds = filter ? await countFilesByKind(db(), accountId, filter) : { video: 0, audio: 0, image: 0, other: 0 };
  return { all: kinds.video + kinds.audio + kinds.image + kinds.other, ...kinds };
}

/** "All Files": one page of every file in the account (at any depth, no folders), with where each is. */
export async function allFilesPage(accountId: string, query: AllFilesQuery, now = new Date()): Promise<AllFilesPage> {
  const after = afterOf(query.cursor, query.sort);
  const filter = filterOf(query, now);
  // The chips count the search alone (their own type left out); a page lists both together.
  const unfiltered = filterOf({ ...query, kind: "all" }, now);
  const counts = after ? Promise.resolve(null) : countsOf(accountId, unfiltered);
  if (!filter) return { items: [], nextCursor: null, counts: await counts };
  const rows = await filesPage(db(), accountId, filter, allFilesOrder(query.sort), after, query.limit);
  const last = rows.at(-1);
  return {
    items: await withPaths(rows),
    nextCursor: rows.length === query.limit && last ? encodeAllFilesCursor({ value: allFilesSortValue(last, query.sort), id: last.id }) : null,
    counts: await counts,
  };
}
