"use client";

import { useRouter } from "next/navigation";
import type { FolderView, NodeItem } from "@/contracts/nodes";
import { folderHref, sharePageHref } from "@/shared/lib/routes";
import type { NodeActions } from "./node-menu";
import type { useFileDialogs } from "./useFileDialogs";
import type { useFileMedia } from "./useFileMedia";

interface Options {
  view: FolderView;
  isAdmin: boolean;
  dialogs: ReturnType<typeof useFileDialogs>["open"];
  media: ReturnType<typeof useFileMedia>;
  linkOf: (linkId: string) => string;
  copyLink: (url: string, visibility: "private" | "public") => void;
  onProperties: (id: string) => void;
}

/**
 * What each entry of an item's action menu does. The current folder (its header menu) is
 * handled like its own item: it moves within its parent and shares with the parent's visibility.
 */
export function useNodeActions({ view, isAdmin, dialogs, media, linkOf, copyLink, onProperties }: Options): (item: NodeItem) => NodeActions {
  const router = useRouter();
  const { folder, path, isRoot } = view;
  const parentOfCurrent = path.at(-2);
  const visibilityOf = (item: NodeItem) => (item.settings.visibility === "inherit" ? view.effectiveVisibility : item.settings.visibility);

  return (item) => {
    const current = item.id === folder.id;
    const parentId = current ? (parentOfCurrent?.id ?? folder.id) : folder.id;
    const parentVisibility = current ? view.parentVisibility : view.effectiveVisibility;
    return {
      open: item.type === "folder" && !current ? () => router.push(folderHref(item.id)) : undefined,
      preview: item.type === "file" ? () => media.preview(item) : undefined,
      download: () => media.download(item),
      downloadZip: item.type === "file" ? () => media.zip([item]) : undefined,
      share: item.type === "folder" ? () => router.push(sharePageHref(item.linkId)) : undefined,
      uploadLinks: item.type === "folder" ? () => dialogs.uploadLinks(item) : undefined,
      tags: () => dialogs.tags([item]),
      directLink: () => copyLink(linkOf(item.linkId), current ? view.effectiveVisibility : visibilityOf(item)),
      newLink: () => dialogs.newLink(item),
      activity: () => dialogs.activity(item),
      settings: () => dialogs.settings(item, current && isRoot, parentVisibility),
      togglePause: isAdmin ? () => void dialogs.togglePause(item) : undefined,
      rename: () => dialogs.rename(item),
      copy: () => dialogs.move([item], "copy", parentId),
      move: () => dialogs.move([item], "move", parentId),
      delete: () => dialogs.remove([item]),
      properties: () => onProperties(item.id),
    };
  };
}
