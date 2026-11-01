import "server-only";
import type { ApiV1Account, ApiV1NodePatch, ApiV1Share, ApiV1SharePatch, ApiV1UploadedFile } from "@/contracts/api-tokens";
import type { NodeItem, SettingsInput } from "@/contracts/nodes";
import { nameError, uniqName } from "@/domain/names";
import { db } from "../db/client";
import { ApiError } from "../http/api-error";
import { accountUsage, findNode, listSiblingNames } from "../repositories/node.repo";
import { shareUrl } from "../share/share.service";
import type { ApiCaller } from "./api-token.service";
import { uploadWholeFile } from "./direct-upload.service";
import { renameNode, requireFolder, requireNode } from "./node-ops.service";
import { regenerateLink, updateSettings } from "./node-settings.service";
import { getProperties, toNodeItem } from "./node.service";
import { moveNodes } from "./transfer.service";

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

/**
 * Renames and/or moves an item. A name already taken where the item ends up is a 409 with a
 * suggestion, like renaming in the web app (no silent "Name (2)"). Moving goes first, so a
 * new name is checked in the target folder.
 */
export async function updateNodeFromApi(caller: ApiCaller, nodeId: string, input: ApiV1NodePatch): Promise<NodeItem> {
  const owner = caller.account;
  const row = await requireNode(owner.id, nodeId);
  const name = input.name?.trim() ?? row.name;
  const error = nameError(name);
  if (error) throw new ApiError("BAD_REQUEST", error, { fields: { name: error } });

  if (input.parentId !== undefined) {
    const target = await requireFolder(owner.id, input.parentId);
    if (target.id !== row.parentId) {
      const taken = await listSiblingNames(db(), target.id);
      if (taken.includes(name)) {
        const message = `Server rejected: "${name}" already exists here. Suggested: ${uniqName(taken, name, row.type === "FILE")}`;
        throw new ApiError("CONFLICT", message, { fields: { name: message } });
      }
      await moveNodes(owner, [row.id], target.id);
    }
  }
  if (input.name !== undefined) return renameNode(owner, row.id, name);
  return toNodeItem(await requireNode(owner.id, row.id));
}

/** An item's share link and settings. */
export async function shareOf(caller: ApiCaller, nodeId: string): Promise<ApiV1Share> {
  const { item, effectiveVisibility } = await getProperties(caller.account.id, nodeId);
  const { settings } = item;
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    linkId: item.linkId,
    url: shareUrl(item.linkId),
    visibility: settings.visibility,
    effectiveVisibility,
    access: settings.access,
    downloadLimit: settings.downloadLimit,
    downloads: item.downloads,
    note: settings.note,
    hasPassword: settings.hasPassword,
    expiry: settings.expiry,
    expAt: settings.expAt,
    burn: settings.burn,
  };
}

/** Changes the share settings sent; the others keep their values (the web app saves all at once). */
export async function updateShareFromApi(caller: ApiCaller, nodeId: string, patch: ApiV1SharePatch): Promise<ApiV1Share> {
  const owner = caller.account;
  if (!owner.isAdmin && (patch.expiry !== undefined || patch.burn !== undefined)) throw new ApiError("FORBIDDEN", "Only admins can change expiry and delete after download.");
  const { settings } = toNodeItem(await requireNode(owner.id, nodeId));
  const input: SettingsInput = {
    visibility: patch.visibility ?? settings.visibility,
    expiry: patch.expiry ?? settings.expiry,
    burn: patch.burn ?? settings.burn,
    downloadLimit: patch.downloadLimit === undefined ? settings.downloadLimit : patch.downloadLimit,
    password: patch.password === undefined ? undefined : (patch.password ?? ""),
    access: patch.access ?? settings.access,
    note: patch.note ?? settings.note,
    applyDown: patch.applyDown ?? false,
  };
  await updateSettings(owner, nodeId, input);
  return shareOf(caller, nodeId);
}

/** Replaces an item's share link (the old one stops working) and answers with the new one. */
export async function regenerateLinkFromApi(caller: ApiCaller, nodeId: string): Promise<ApiV1Share> {
  await regenerateLink(caller.account, nodeId);
  return shareOf(caller, nodeId);
}
