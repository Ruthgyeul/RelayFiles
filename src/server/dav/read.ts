import "server-only";
import { DAV } from "@/config/policy";
import { davDepth, davMultistatus, type DavEntry } from "@/domain/dav";
import { db } from "../db/client";
import { listChildren, type NodeRow } from "../repositories/node.repo";
import { XML } from "./respond";

const entryOf = (row: NodeRow, segments: string[], name: string): DavEntry => ({
  segments,
  folder: row.type === "FOLDER",
  name,
  size: row.size,
  mime: row.mime,
  etag: row.sha256,
  createdAt: row.createdAt,
  modifiedAt: row.modifiedAt ?? row.createdAt,
});

/** PROPFIND with Depth 0 or 1 (infinity is refused: a whole account in one answer). */
export async function propfind(req: Request, row: NodeRow, segments: string[]): Promise<Response> {
  const depth = davDepth(req.headers.get("depth"));
  if (depth === "infinity") {
    return new Response('<?xml version="1.0" encoding="utf-8"?>\n<D:error xmlns:D="DAV:"><D:propfind-finite-depth/></D:error>\n', { status: 403, headers: { "content-type": XML } });
  }
  const entries = [entryOf(row, segments, segments.at(-1) ?? row.name)];
  if (row.type === "FOLDER" && depth === "1") {
    // A replaced file's row steps aside under a name with "/" for a moment; it is never listed.
    const children = (await listChildren(db(), row.id)).filter((child) => !child.name.includes("/")).sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) entries.push(entryOf(child, [...segments, child.name], child.name));
  }
  return new Response(davMultistatus(DAV.prefix, entries), { status: 207, headers: { "content-type": XML, "cache-control": "no-store" } });
}
