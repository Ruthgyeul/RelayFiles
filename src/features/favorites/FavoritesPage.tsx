"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FavoriteFolderDto, FavoritesView } from "@/contracts/favorites";
import type { TaggedItem } from "@/contracts/nodes";
import { itemCount } from "@/domain/tree";
import { ActionMenu, anchorOf, type AnchorRect, type MenuEntry } from "@/features/files/ActionMenu";
import { FileList } from "@/features/files/FileList";
import type { ItemProps } from "@/features/files/item-props";
import type { ListedItem } from "@/features/files/useFolderItems";
import { PathBar } from "@/features/files/PathBar";
import { PropertiesDialog } from "@/features/files/PropertiesDialog";
import { ToolButton } from "@/features/files/Toolbar";
import { useCopyLink } from "@/features/files/useCopyLink";
import { useFileDialogs } from "@/features/files/useFileDialogs";
import { useFileMedia } from "@/features/files/useFileMedia";
import { usePrefs } from "@/features/files/usePrefs";
import { useSelection } from "@/features/files/useSelection";
import { useShell } from "@/features/shell/ShellProvider";
import { usePageTitle } from "@/features/shell/usePageTitle";
import { useNow } from "@/shared/hooks/useNow";
import { favoriteFolderHref, favoritesHref, folderHref, sharePageHref } from "@/shared/lib/routes";
import { FavoriteFolderRow } from "./FavoriteFolderRow";
import { useFavoriteDialogs } from "./useFavoriteDialogs";

const CLOCK_TICK_MS = 30_000;

interface Props {
  view: FavoritesView;
  isAdmin: boolean;
  publicUrl: string;
  initialView?: string;
}

type Menu = { kind: "item"; id: string; anchor: AnchorRect } | { kind: "folder"; id: string; anchor: AnchorRect };

/**
 * Favorites: items listed where they are (opening, sharing and renaming act on the item
 * itself), and organizing folders that exist only here.
 */
export function FavoritesPage({ view, isAdmin, publicUrl, initialView }: Props) {
  const router = useRouter();
  const { activeAccount } = useShell();
  const [prefs] = usePrefs();
  const now = useNow(true, CLOCK_TICK_MS);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [propertiesFor, setPropertiesFor] = useState<string | null>(null);
  const title = view.folder?.name ?? "Favorites";
  usePageTitle(title);

  const items = view.items;
  const selection = useSelection(items);
  const linkOf = (linkId: string) => `${publicUrl}/d/${linkId}`;
  const media = useFileMedia(items, title, initialView);
  const files = useFileDialogs({ isAdmin, accountDeletesAt: activeAccount?.deletesAt ?? null, linkOf, onChanged: selection.clear });
  const favorites = useFavoriteDialogs({ view, onChanged: selection.clear });
  const { copyText, copyLink } = useCopyLink();
  const byId = new Map(items.map((item) => [item.id, item]));
  const withListed = (run: (item: TaggedItem) => void) => (listed: ListedItem) => {
    const item = byId.get(listed.id);
    if (item) run(item);
  };

  const crumbs = [{ id: "favorites", name: "Favorites" }, ...view.path];
  const openItem = (item: TaggedItem) => (item.type === "folder" ? router.push(favoriteFolderHref([item.id])) : media.preview(item));
  const toggleMenu = (next: Menu) => setMenu((current) => (current?.kind === next.kind && current.id === next.id ? null : next));

  const itemMenu = (item: TaggedItem): MenuEntry[] => [
    item.type === "folder" ? { label: "Open", icon: "folder-open", onSelect: () => openItem(item) } : { label: "Preview", icon: "eye", onSelect: () => media.preview(item) },
    { label: "Download", icon: "download-simple", onSelect: () => media.download(item) },
    { label: "Show in folder", icon: "arrow-up-right", onSelect: () => router.push(folderHref(item.parentId, item.parentIsRoot)) },
    { label: "Move in favorites", icon: "arrow-bend-up-right", separator: true, onSelect: () => favorites.open.move({ nodeIds: [item.id], folderIds: [], label: `"${item.name}"` }) },
    { label: "Remove from favorites", icon: "star", onSelect: () => void files.open.toggleFavorite([item], false) },
    ...(item.type === "folder" ? [{ label: "Share", icon: "share-network", separator: true, onSelect: () => router.push(sharePageHref(item.linkId)) } satisfies MenuEntry] : []),
    { label: "Tags", icon: "tag", separator: item.type !== "folder", onSelect: () => files.open.tags([item]) },
    { label: "Link activity", icon: "chart-line-up", onSelect: () => files.open.activity(item) },
    { label: "Rename", icon: "pencil-simple", separator: true, onSelect: () => files.open.rename(item) },
    { label: "Delete", icon: "trash", danger: true, onSelect: () => favorites.open.remove([item]) },
    { label: "Properties", icon: "info", separator: true, onSelect: () => setPropertiesFor(item.id) },
  ];

  const folderMenu = (folder: FavoriteFolderDto): MenuEntry[] => [
    { label: "Open", icon: "folder-open", onSelect: () => router.push(favoritesHref(folder.id)) },
    { label: "Rename", icon: "pencil-simple", separator: true, onSelect: () => favorites.open.rename(folder) },
    { label: "Move in favorites", icon: "arrow-bend-up-right", onSelect: () => favorites.open.move({ nodeIds: [], folderIds: [folder.id], label: `"${folder.name}"` }) },
    { label: "Delete", icon: "trash", danger: true, onSelect: () => void favorites.open.deleteFolder(folder) },
  ];

  const menuEntries = menu?.kind === "item" ? items.find((item) => item.id === menu.id) : undefined;
  const menuFolder = menu?.kind === "folder" ? view.folders.find((folder) => folder.id === menu.id) : undefined;

  const itemProps = (listed: ListedItem): ItemProps => propsOf(byId.get(listed.id)!);
  const propsOf = (item: TaggedItem): ItemProps => ({
    item,
    parentPath: item.parentPath,
    parentVisibility: "private",
    selected: selection.has(item.id),
    now,
    onToggle: () => selection.toggle(item.id),
    onPrimary: () => openItem(item),
    onPreview: () => media.preview(item),
    onMenu: (anchor) => toggleMenu({ kind: "item", id: item.id, anchor: anchorOf(anchor) }),
    onTag: () => undefined,
    menuOpen: menu?.kind === "item" && menu.id === item.id,
  });

  const selected = selection.items;
  const count = view.folders.length + items.length;
  return (
    <>
      <PathBar path={crumbs} rootIcon="star" hrefOf={(index) => favoritesHref(index === 0 ? null : crumbs[index]!.id)} onCopyPath={(text) => copyText(text, "Path copied")} />
      <div className="flex flex-wrap items-center gap-2.5 px-0.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[22px] font-bold">{title}</span>
          <span className="text-[13px] text-t4">{view.folder ? itemCount(count) : `${itemCount(count)} · they stay where they are; opening, sharing or renaming here changes the item itself`}</span>
        </div>
        {selected.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <ToolButton icon="arrow-bend-up-right" label="Move" title="Move in favorites" onClick={() => favorites.open.move({ nodeIds: selected.map((item) => item.id), folderIds: [], label: `${selected.length} items` })} />
            <ToolButton icon="star" label="Remove" title="Remove from favorites" onClick={() => void files.open.toggleFavorite(selected, false)} />
            <ToolButton icon="trash" label="Delete" danger onClick={() => favorites.open.remove(selected)} />
          </div>
        ) : (
          <ToolButton icon="folder-plus" label="New folder" onClick={favorites.open.newFolder} />
        )}
      </div>
      <FileList
        items={items}
        view={prefs.view}
        itemProps={itemProps}
        emptyTitle={view.folder ? "This folder is empty" : "No favorites yet"}
        emptyActions={<span className="text-[13px] text-t4">Choose &quot;Add to favorites&quot; in an item&apos;s menu.</span>}
        onOpen={withListed(openItem)}
        onDownload={withListed(media.download)}
        onDropFiles={() => undefined}
        hideEmpty={view.folders.length > 0}
        leading={
          view.folders.length > 0 ? (
            <>
              {view.folders.map((folder) => (
                <FavoriteFolderRow key={folder.id} folder={folder} menuOpen={menu?.kind === "folder" && menu.id === folder.id} onMenu={(anchor) => toggleMenu({ kind: "folder", id: folder.id, anchor: anchorOf(anchor) })} />
              ))}
            </>
          ) : undefined
        }
      />
      {menu && (menuEntries || menuFolder) && (
        <ActionMenu
          anchor={menu.anchor}
          label={`Actions for ${menuEntries?.name ?? menuFolder?.name ?? ""}`}
          entries={menuEntries ? itemMenu(menuEntries) : folderMenu(menuFolder!)}
          onClose={() => setMenu(null)}
        />
      )}
      <PropertiesDialog
        nodeId={propertiesFor}
        onClose={() => setPropertiesFor(null)}
        linkOf={linkOf}
        onCopyLink={copyLink}
        onEditTags={(id) => {
          const item = byId.get(id);
          if (!item) return;
          setPropertiesFor(null);
          files.open.tags([item]);
        }}
        onZip={(id) => {
          const item = byId.get(id);
          if (item) media.zip([item]);
        }}
      />
      {media.viewer}
      {files.dialogs}
      {favorites.dialogs}
    </>
  );
}
