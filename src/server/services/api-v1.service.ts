import "server-only";
import type { ApiV1Account, ApiV1UploadedFile } from "@/contracts/api-tokens";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { accountUsage, findNode } from "../repositories/node.repo";
import { shareUrl } from "../share/share.service";
import type { ApiCaller } from "./api-token.service";
import { uploadWholeFile } from "./direct-upload.service";

/** The token's account as API v1 shows it. */
export async function apiAccount(caller: ApiCaller): Promise<ApiV1Account> {
  const { account } = caller;
  const usage = await accountUsage(db(), account.id);
  return {
    id: account.id,
    name: account.name,
    isAdmin: account.isAdmin,
    quotaBytes: account.quotaBytes?.toString() ?? null,
    usedBytes: usage.usedBytes.toString(),
    scopes: [...caller.scopes],
  };
}

/** Stores a whole-body upload and answers with its share link, ready to paste (ShareX). */
export async function uploadFromApi(caller: ApiCaller, folder: string, name: string, size: number, body: ReadableStream<Uint8Array>): Promise<ApiV1UploadedFile> {
  const file = await uploadWholeFile(caller.account, folder, name, size, body);
  const node = await findNode(db(), caller.account.id, file.nodeId);
  if (!node) throw new ApiError("NOT_FOUND");
  return { ...file, linkId: node.linkId, url: shareUrl(node.linkId) };
}
