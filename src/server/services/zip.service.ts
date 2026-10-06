import "server-only";
import { Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { contentDisposition, zipName } from "@/domain/serving";
import { db } from "../db/client";
import { LazyReadable } from "../files/lazy-readable";
import { ApiError } from "../http/api-error";
import { logger } from "../logger";
import type { AccountRow } from "../repositories/account.repo";
import { ancestorChain, findNode, subtreeRows } from "../repositories/node.repo";
import { addTraffic } from "../repositories/traffic.repo";
import { topLevel } from "./node-ops.service";
import { driverForAccount } from "./volume.service";

type Owner = Pick<AccountRow, "id" | "volumeId">;

/** One archive entry: a folder (keeps empty folders) or a file opened when the zip reaches it. */
export type ZipEntry = { name: string; folder: true } | { name: string; folder?: false; open: () => Promise<Readable> };

/** Streams entries as one zip (store mode: media is already compressed). */
export function zipResponse(entries: readonly ZipEntry[], fileName: string): Response {
  const archive = new ZipArchive({ store: true });
  for (const entry of entries) {
    if (entry.folder) archive.append(Buffer.alloc(0), { name: `${entry.name}/` });
    else archive.append(new LazyReadable(entry.open), { name: entry.name });
  }
  archive.on("warning", (error) => logger.warn("zip warning", { error }));
  archive.on("error", (error) => logger.error("zip failed", { error }));
  void archive.finalize();
  return new Response(Readable.toWeb(archive) as ReadableStream, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": contentDisposition("attachment", fileName),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}

/**
 * The owner's zip of selected files and folders. Files keep their folder structure under
 * each selected item's name.
 */
export async function zipItems(owner: Owner, ids: string[]): Promise<Response> {
  const items = await topLevel(owner.id, ids, true);
  if (items.length === 0) throw new ApiError("NOT_FOUND");
  const driver = await driverForAccount(owner);
  const parent = items[0]!.parentId ? await findNode(db(), owner.id, items[0]!.parentId) : null;

  const entries: ZipEntry[] = [];
  let bytes = 0n;
  for (const item of items) {
    const base = (await ancestorChain(db(), item.id)).slice(1).map((row) => row.name);
    const rows = await subtreeRows(db(), item.id);
    const pathOf = new Map<string, string[]>([[item.id, base]]);
    for (const row of rows) {
      if (row.id !== item.id) pathOf.set(row.id, [...pathOf.get(row.parentId!)!, row.name]);
      const segments = pathOf.get(row.id)!;
      // Entries sit under the selected item's own name ("Trip/day1/a.jpg"); a selected file is just its name.
      const name = item.type === "FILE" ? item.name : [item.name, ...segments.slice(base.length)].join("/");
      if (row.type !== "FILE") {
        entries.push({ name, folder: true });
        continue;
      }
      bytes += row.size;
      entries.push({ name, open: () => driver.createReadStream({ accountId: owner.id, segments }) });
    }
  }
  addTraffic(db(), owner.id, bytes, new Date()).catch((error: unknown) => logger.warn("traffic not recorded", { error }));
  return zipResponse(entries, zipName(items.map((item) => ({ name: item.name, folder: item.type === "FOLDER" })), parent?.name ?? "root"));
}
