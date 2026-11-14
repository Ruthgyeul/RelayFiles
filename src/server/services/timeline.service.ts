import "server-only";
import type { TimelineItem, TimelinePage, TimelineQuery } from "@/contracts/timeline";
import { decodeTimelineCursor, encodeTimelineCursor } from "@/domain/timeline";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { findRootFolder } from "../repositories/node.repo";
import { timelinePage, type TimelineRow } from "../repositories/timeline.repo";

const toItem = (row: TimelineRow, rootId: string): TimelineItem => ({
  id: row.id,
  name: row.name,
  kind: row.kind === "VIDEO" ? "video" : "image",
  size: row.size.toString(),
  hasThumb: row.hasThumb,
  date: row.sortAt.toISOString(),
  dated: row.dated,
  parentId: row.parentId,
  parentIsRoot: row.parentId === rootId,
});

/** "Photos": one page of the account's photos and videos, newest first. */
export async function timeline(accountId: string, query: TimelineQuery): Promise<TimelinePage> {
  const after = query.cursor === undefined ? null : decodeTimelineCursor(query.cursor);
  if (query.cursor !== undefined && !after) throw new ApiError("BAD_REQUEST", "Unknown cursor.");
  const [root, rows] = await Promise.all([findRootFolder(db(), accountId), timelinePage(db(), accountId, after, query.limit)]);
  if (!root) throw new ApiError("NOT_FOUND");
  const last = rows.at(-1);
  return {
    items: rows.map((row) => toItem(row, root.id)),
    nextCursor: rows.length === query.limit && last ? encodeTimelineCursor({ at: last.sortAt.getTime(), id: last.id }) : null,
  };
}
