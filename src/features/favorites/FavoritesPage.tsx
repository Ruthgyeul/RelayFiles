"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FavoritesView } from "@/contracts/favorites";
import type { TaggedItem } from "@/contracts/nodes";
import { FAVORITE_SORT_KEYS, FAVORITE_SORT_OPTION_LABEL, FAVORITE_SORT_SHORT_LABEL, type FavoriteSortKey } from "@/domain/favorites";
import { emptyTitle, itemCount } from "@/domain/tree";
import { ActionMenu, anchorOf, type AnchorRect } from "@/features/files/ActionMenu";
import { FileList } from "@/features/files/FileList";
import { FilterBar } from "@/features/files/FilterBar";
import type { ItemProps } from "@/features/files/item-props";
import { PathBar } from "@/features/files/PathBar";
import { PropertiesDialog } from "@/features/files/PropertiesDialog";
import { SearchBox, TagModeBar } from "@/features/files/SearchBox";
import { ToolButton, Toolbar, type SortOptions } from "@/features/files/Toolbar";
import { useCopyLink } from "@/features/files/useCopyLink";
import { useFileDialogs } from "@/features/files/useFileDialogs";
import { useFileMedia } from "@/features/files/useFileMedia";
import { useFileSearch } from "@/features/files/useFileSearch";
import { useFileShortcuts } from "@/features/files/useFileShortcuts";
import { useViewPrefs, type ViewPrefs } from "@/features/files/usePrefs";
import { useSelection } from "@/features/files/useSelection";
import { useShell } from "@/features/shell/ShellProvider";
import { usePageTitle } from "@/features/shell/usePageTitle";
import { useNow } from "@/shared/hooks/useNow";
import { favoriteFolderHref, favoritesHref, folderHref, sharePageHref } from "@/shared/lib/routes";
import { favoriteFolderMenu, favoriteItemMenu } from "./favorite-menu";
import { FavoriteFolderCard } from "./FavoriteFolderCard";
import { FavoriteFolderRow } from "./FavoriteFolderRow";
import { useFavoriteDialogs } from "./useFavoriteDialogs";
import { useFavoriteItems } from "./useFavoriteItems";

const CLOCK_TICK_MS = 30_000;
/** View and sort of Favorites, remembered apart from the File Manager's. */
const PREFS_KEY = "relay.favoritesView";
const DEFAULT_PREFS: ViewPrefs<FavoriteSortKey> = { view: "list", sort: "added" };
const SORT_OPTIONS: SortOptions<FavoriteSortKey> = { keys: FAVORITE_SORT_KEYS, label: FAVORITE_SORT_OPTION_LABEL, short: FAVORITE_SORT_SHORT_LABEL };

interface Props {
  view: FavoritesView;
  isAdmin: boolean;
  publicUrl: string;
  initialView?: string;
}

type Menu = { kind: "item" | "folder"; id: string; anchor: AnchorRect };

/**
 * Favorites: items listed where they are (opening, sharing and renaming act on the item
 * itself), and organizing folders that exist only here. Search, tag search, type filters,
 * sort and grid or list work as in the File Manager; tag search covers every organizing folder.
 */
export function FavoritesPage({ view, isAdmin, publicUrl, initialView }: Props) {
  const router = useRouter();
  const { notify, activeAccount } = useShell();
  const [prefs, setPrefs] = useViewPrefs(PREFS_KEY, FAVORITE_SORT_KEYS, DEFAULT_PREFS);
  const search = useFileSearch();
  const now = useNow(true, CLOCK_TICK_MS);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [propertiesFor, setPropertiesFor] = useState<string | null>(null);
  const title = view.folder?.name ?? "Favorites";
  usePageTitle(title);

  const { items, folders, counts, tagMode, wanted, q } = useFavoriteItems(view, search.filter, search.query, prefs.sort);
  const selection = useSelection(items);
  const linkOf = (linkId: string) => `${publicUrl}/d/${linkId}`;
  const media = useFileMedia(items, title, initialView);
  const files = useFileDialogs({ isAdmin, accountDeletesAt: activeAccount?.deletesAt ?? null, linkOf, onChanged: selection.clear });
  const favorites = useFavoriteDialogs({ view, onChanged: selection.clear });
  const { copyText, copyLink } = useCopyLink();
  const byId = new Map(items.map((item) => [item.id, item]));
  const withListed = (run: (item: TaggedItem) => void) => (listed: { id: string }) => {
    const item = byId.get(listed.id);
    if (item) run(item);
  };

  const crumbs = [{ id: "favorites", name: "Favorites" }, ...view.path];
  const parentHref = view.folder ? favoritesHref(view.path.at(-2)?.id ?? null) : null;
  const openItem = (item: TaggedItem) => (item.type === "folder" ? router.push(favoriteFolderHref([item.id])) : media.preview(item));
  const toggleMenu = (next: Menu) => setMenu((current) => (current?.kind === next.kind && current.id === next.id ? null : next));
  const toggleView = () => setPrefs({ view: prefs.view === "grid" ? "list" : "grid" });
  const changed = <T,>(run: (value: T) => void) => (value: T) => (run(value), selection.clear());

  useFileShortcuts({ selectAll: selection.selectAll, search: search.openSearch, toggleView, parent: () => parentHref && router.push(parentHref) });

  const itemMenu = (item: TaggedItem) =>
    favoriteItemMenu(item, {
      open: openItem,
      preview: media.preview,
      download: media.download,
      showInFolder: (target) => router.push(folderHref(target.parentId, target.parentIsRoot)),
      moveInFavorites: (target) => favorites.open.move({ nodeIds: [target.id], folderIds: [], label: `"${target.name}"` }),
      unfavorite: (target) => void files.open.toggleFavorite([target], false),
      share: (target) => router.push(sharePageHref(target.linkId)),
      tags: (target) => files.open.tags([target]),
      activity: files.open.activity,
      rename: files.open.rename,
      remove: (target) => favorites.open.remove([target]),
      properties: (target) => setPropertiesFor(target.id),
    });
  const menuItem = menu?.kind === "item" ? byId.get(menu.id) : undefined;
  const menuFolder = menu?.kind === "folder" ? view.folders.find((folder) => folder.id === menu.id) : undefined;

  const itemProps = (listed: { id: string }): ItemProps => {
    const item = byId.get(listed.id)!;
    return {
      item,
      parentPath: item.parentPath,
      parentVisibility: "private",
      selected: selection.has(item.id),
      now,
      onToggle: (range) => selection.toggle(item.id, range),
      onPrimary: () => openItem(item),
      onPreview: () => media.preview(item),
      onMenu: (anchor) => toggleMenu({ kind: "item", id: item.id, anchor: anchorOf(anchor) }),
      onTag: changed(search.searchTag),
      menuOpen: menu?.kind === "item" && menu.id === item.id,
    };
  };
  const folderProps = (id: string) => ({ menuOpen: menu?.kind === "folder" && menu.id === id, onMenu: (anchor: HTMLElement) => toggleMenu({ kind: "folder", id, anchor: anchorOf(anchor) }) });

  const selected = selection.items;
  const count = view.folders.length + view.items.length;
  const searching = tagMode || q !== "" || search.filter !== "all";
  return (
    <>
      <PathBar path={crumbs} rootIcon="star" hrefOf={(index) => favoritesHref(index === 0 ? null : crumbs[index]!.id)} onCopyPath={(text) => copyText(text, "Path copied")} />
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <span className="truncate text-[22px] font-bold">{title}</span>
        <span className="text-[13px] text-t4">{view.folder ? itemCount(count) : `${itemCount(count)} · they stay where they are; opening, sharing or renaming here changes the item itself`}</span>
      </div>
      <Toolbar
        allSelected={selection.allSelected}
        selectedCount={selected.length}
        onToggleAll={selection.toggleAll}
        selectionActions={
          <>
            <ToolButton icon="arrow-bend-up-right" label="Move" title="Move in favorites" onClick={() => favorites.open.move({ nodeIds: selected.map((item) => item.id), folderIds: [], label: `${selected.length} items` })} />
            <ToolButton icon="star" label="Remove" title="Remove from favorites" onClick={() => void files.open.toggleFavorite(selected, false)} />
            <ToolButton icon="trash" label="Delete" danger onClick={() => favorites.open.remove(selected)} />
          </>
        }
        folderActions={<ToolButton icon="folder-plus" label="New folder" onClick={favorites.open.newFolder} />}
        view={prefs.view}
        onToggleView={toggleView}
        onToggleSearch={search.toggleSearch}
        searchLabel="Search in Favorites"
        sort={prefs.sort}
        sortOptions={SORT_OPTIONS}
        onSort={changed((sort: FavoriteSortKey) => setPrefs({ sort }))}
        links={false}
        onRefresh={() => {
          router.refresh();
          notify("Up to date");
        }}
      />
      {count > 0 && <FilterBar counts={counts} value={search.filter} onChange={changed(search.setFilter)} />}
      {search.searchOpen && <SearchBox value={search.query} onChange={search.setQuery} label="Search in Favorites" placeholder="Search in Favorites · #tag1 #tag2 for favorites with all tags" />}
      {tagMode && <TagModeBar label={wanted.length ? wanted.map((tag) => `#${tag}`).join(" + ") : "Type a tag after #"} count={itemCount(items.length)} scope="in Favorites" onClear={search.clear} />}
      <FileList
        items={items}
        view={prefs.view}
        itemProps={itemProps}
        emptyTitle={searching ? emptyTitle({ tagMode, wanted, query: q, filter: search.filter }) : view.folder ? "This folder is empty" : "No favorites yet"}
        emptyActions={searching ? undefined : <span className="text-[13px] text-t4">Choose &quot;Add to favorites&quot; in an item&apos;s menu.</span>}
        onOpen={withListed(openItem)}
        onDownload={withListed(media.download)}
        onDropFiles={() => undefined}
        hideEmpty={folders.length > 0}
        leading={folders.length > 0 ? folders.map((folder) => <FavoriteFolderRow key={folder.id} folder={folder} {...folderProps(folder.id)} />) : undefined}
        leadingCards={folders.length > 0 ? folders.map((folder) => <FavoriteFolderCard key={folder.id} folder={folder} {...folderProps(folder.id)} />) : undefined}
      />
      {menu && (menuItem || menuFolder) && (
        <ActionMenu
          anchor={menu.anchor}
          label={`Actions for ${menuItem?.name ?? menuFolder?.name ?? ""}`}
          entries={
            menuItem
              ? itemMenu(menuItem)
              : favoriteFolderMenu(menuFolder!, {
                  open: (folder) => router.push(favoritesHref(folder.id)),
                  rename: favorites.open.rename,
                  move: (folder) => favorites.open.move({ nodeIds: [], folderIds: [folder.id], label: `"${folder.name}"` }),
                  remove: (folder) => void favorites.open.deleteFolder(folder),
                })
          }
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
