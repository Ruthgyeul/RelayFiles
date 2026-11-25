"use client";

import type { Route } from "next";
import type { TaggedItem } from "@/contracts/nodes";
import type { ActionHandlers } from "@/features/files/item-actions";
import type { useFileDialogs } from "@/features/files/useFileDialogs";
import type { useFileMedia } from "@/features/files/useFileMedia";
import type { useFolderTools } from "@/features/files/useFolderTools";
import { folderHref } from "@/shared/lib/routes";

interface Context {
  dialogs: ReturnType<typeof useFileDialogs>["open"];
  folderTools: ReturnType<typeof useFolderTools>["open"];
  media: ReturnType<typeof useFileMedia>;
  linkOf: (linkId: string) => string;
  copyLink: (url: string, visibility: "private" | "public") => void;
  onProperties: (id: string) => void;
  push: (href: Route) => void;
}

/** The file's folder, with the file open in the viewer. */
export const inFolderHref = (item: TaggedItem) => `${folderHref(item.parentId, item.parentIsRoot)}?view=${item.id}` as Route;

/** What a file's menu does in "All Files" (`ALL_FILES_MENU`): everything acts on the file where it is. */
export function allFilesActions({ dialogs, folderTools, media, linkOf, copyLink, onProperties, push }: Context): (item: TaggedItem) => ActionHandlers {
  return (item) => {
    const visibility = item.settings.visibility === "inherit" ? item.parentVisibility : item.settings.visibility;
    return {
      preview: () => media.preview(item),
      download: () => media.download(item),
      downloadZip: () => media.zip([item]),
      showInFolder: () => push(inFolderHref(item)),
      toggleFavorite: () => void dialogs.toggleFavorite([item], !item.favorite),
      tags: () => dialogs.tags([item]),
      directLink: () => copyLink(linkOf(item.linkId), visibility),
      activity: () => dialogs.activity(item),
      settings: () => dialogs.settings(item, false, item.parentVisibility),
      rename: () => dialogs.rename(item),
      move: () => dialogs.move([item], "move", item.parentId),
      delete: () => dialogs.remove([item]),
      versions: () => folderTools.versions(item),
      rescan: item.scan === "failed" ? () => void dialogs.rescan(item) : undefined,
      properties: () => onProperties(item.id),
    };
  };
}
