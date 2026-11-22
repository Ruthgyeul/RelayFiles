import "server-only";
import type { NodeItem, Visibility } from "@/contracts/nodes";
import { bytesToGb } from "@/domain/traffic";
import type { NodeRow } from "../repositories/node.repo";

/** A row's visibility as the API names it, and back. */
export const VISIBILITY: Record<NodeRow["visibility"], Visibility> = { INHERIT: "inherit", PRIVATE: "private", PUBLIC: "public" };
export const VISIBILITY_TO_DB = { inherit: "INHERIT", private: "PRIVATE", public: "PUBLIC" } as const satisfies Record<Visibility, NodeRow["visibility"]>;

/** A row's kind as the API names it (folders have none). */
export function kindOf(kind: NodeRow["kind"]): NodeItem["kind"] {
  return kind ? (kind.toLowerCase() as NonNullable<NodeItem["kind"]>) : null;
}

/** The API shape of a row; folder stats (size, items, files) come from the caller. */
export function toNodeItem(row: NodeRow, extra: { size?: bigint; itemCount?: number; fileCount?: number } = {}): NodeItem {
  return {
    id: row.id,
    type: row.type === "FOLDER" ? "folder" : "file",
    name: row.name,
    kind: kindOf(row.kind),
    size: (extra.size ?? row.size).toString(),
    createdAt: row.createdAt.toISOString(),
    ...(row.modifiedAt ? { modifiedAt: row.modifiedAt.toISOString() } : {}),
    downloads: row.downloads,
    itemCount: extra.itemCount ?? 0,
    fileCount: extra.fileCount ?? (row.type === "FILE" ? 1 : 0),
    tags: row.tags,
    linkId: row.linkId,
    hasThumb: row.hasThumb,
    settings: {
      visibility: VISIBILITY[row.visibility],
      expiry: row.expiryLabel,
      expAt: row.expAt?.toISOString() ?? null,
      burn: row.burn,
      downloadLimit: row.downloadLimit,
      dailyCapGb: bytesToGb(row.dailyBytesCap),
      hasPassword: row.passwordHash !== null,
      access: row.access === "STREAM" ? "stream" : "both",
      note: row.note,
      dlPaused: row.dlPaused,
    },
    busy: null,
    ...(row.scanState === "PENDING" ? { scan: "pending" as const } : row.scanState === "FAILED" ? { scan: "failed" as const } : {}),
  };
}
