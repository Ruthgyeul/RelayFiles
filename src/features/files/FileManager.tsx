"use client";

import type { Route } from "next";
import type { FolderCrumb, FolderView, NodeItem } from "@/contracts/nodes";
import { emptyTitle } from "@/domain/tree";
import { useTransfers } from "@/features/transfers/transfers-context";
import { ActionMenu } from "./ActionMenu";
import { FavoritesEntry } from "./FavoritesEntry";
import { FolderHeader } from "./FolderHeader";
import { buildMenu, NODE_MENU } from "./item-actions";
import type { ItemProps } from "./item-props";
import { FileList } from "./FileList";
import { ListChrome } from "./ListChrome";
import { PathBar } from "./PathBar";
import { folderHref, sharePageHref } from "@/shared/lib/routes";
import { PropertiesDialog } from "./PropertiesDialog";
import { FILE_SORT_OPTIONS, Toolbar } from "./Toolbar";
import { toolbarActions } from "./ToolbarActions";
import { useFolderDrop } from "./useFolderDrop";
import { useFolderTools } from "./useFolderTools";
import { useFileSearch } from "./useFileSearch";
import { useFileShortcuts } from "./useFileShortcuts";
import { useFolderItems, type ListedItem } from "./useFolderItems";
import { useItemMenu } from "./useItemMenu";
import { useListPage } from "./useListPage";
import { useNewFolder } from "./useNewFolder";
import { useNodeActions } from "./useNodeActions";
import { usePrefs } from "./usePrefs";

/** A folder reached another way than from the root (a favorite folder opened from Favorites). */
export interface FolderNav {
  /** Crumbs shown instead of the folder's real path. */
  path: FolderCrumb[];
  hrefOf: (index: number) => Route;
  rootIcon: "star";
  /** Where a subfolder opens. */
  folderHref: (id: string) => Route;
}

interface FileManagerProps {
  view: FolderView;
  nav?: FolderNav;
  isAdmin: boolean;
  publicUrl: string;
  /** A file of this folder to open in the viewer right away (global search `?view=`). */
  initialView?: string;
}

/** The File Manager page for one folder: path, header, toolbar, filters, search, items and dialogs. */
export function FileManager({ view, nav, isAdmin, publicUrl, initialView }: FileManagerProps) {
  const [prefs, setPrefs] = usePrefs();
  const search = useFileSearch();
  const { folder, children, path, isRoot } = view;
  const parentRef = isRoot ? "root" : folder.id;
  const { items, counts, tagMode, wanted, q, searchError } = useFolderItems(children, search.filter, search.query, prefs.sort);
  const { router, now, selection, linkOf, media, files, copyText, copyLink, propertiesFor, setPropertiesFor, refresh } = useListPage({ items, title: folder.name, isAdmin, publicUrl, initialView });
  const clearSelection = selection.clear;
  const { open, dialogs } = files;
  const menu = useItemMenu(folder, items);
  const folderTools = useFolderTools(clearSelection);
  const newFolder = useNewFolder(parentRef, children.map((child) => child.name));

  const transfers = useTransfers();
  const uploadTarget = { ref: parentRef, name: folder.name };
  const { drag, dropFiles } = useFolderDrop(folder, uploadTarget, items, selection.ids, clearSelection);

  const subfolderHref = nav?.folderHref ?? ((id: string) => folderHref(id));
  const actionsFor = useNodeActions({ view, isAdmin, dialogs: open, folderTools: folderTools.open, media, linkOf, copyLink, onProperties: setPropertiesFor, folderHref: subfolderHref });
  const openItem = (item: NodeItem) => (item.type === "folder" ? router.push(subfolderHref(item.id)) : media.preview(item));
  const parentOfCurrent = path.at(-2);
  const parentHref = nav ? (nav.path.length > 1 ? nav.hrefOf(nav.path.length - 2) : null) : parentOfCurrent ? folderHref(parentOfCurrent.id, path.length === 2) : null;

  useFileShortcuts({
    upload: () => transfers.pickFiles(uploadTarget),
    selectAll: selection.selectAll,
    search: search.openSearch,
    toggleView: () => setPrefs({ view: prefs.view === "grid" ? "list" : "grid" }),
    parent: () => parentHref && router.push(parentHref),
    remove: () => selection.items.length > 0 && open.remove(selection.items),
  });

  const selectedItems = selection.items;
  const { menuItem, withItem } = menu;
  const searchTag = (tag: string) => {
    search.searchTag(tag);
    clearSelection();
  };

  const itemProps = (item: ListedItem): ItemProps => ({
    item,
    parentPath: item.parentPath,
    parentVisibility: item.parentVisibility ?? view.effectiveVisibility,
    selected: selection.has(item.id),
    now,
    onToggle: (range) => selection.toggle(item.id, range),
    onPrimary: () => openItem(item),
    onPreview: () => media.preview(item),
    onMenu: (anchor) => menu.toggle(item.id, anchor),
    onTag: searchTag,
    menuOpen: menu.isOpenFor(item.id),
    drag: tagMode ? undefined : drag.dragProps(item.id, item.name),
    drop: item.type === "folder" && !tagMode ? drag.dropProps(item.id) : undefined,
    dropOver: drag.over === item.id,
  });

  const toolbar = toolbarActions({
    upload: () => transfers.pickFiles(uploadTarget),
    uploadFolder: () => transfers.pickFolder(uploadTarget),
    newFolder: newFolder.open,
    selection: {
      download: () => (media.downloadEach(selectedItems), clearSelection()),
      downloadZip: () => (media.zip(selectedItems), clearSelection()),
      tags: () => open.tags(selectedItems),
      toggleFavorite: () => void open.toggleFavorite(selectedItems, true),
      copy: () => open.move(selectedItems, "copy", folder.id),
      move: () => open.move(selectedItems, "move", folder.id),
      rename: () => folderTools.open.rename(selectedItems, tagMode ? null : children.map((child) => child.name)),
      delete: () => open.remove(selectedItems),
    },
  });

  return (
    <>
      <PathBar
        path={nav?.path ?? path}
        hrefOf={nav?.hrefOf}
        rootIcon={nav?.rootIcon}
        onCopyPath={(text) => copyText(text, "Path copied")}
        dropFor={nav ? undefined : drag.dropProps}
        over={drag.over}
      />
      <FolderHeader
        view={view}
        now={now}
        onShare={() => copyLink(linkOf(folder.linkId), view.effectiveVisibility)}
        onSharePage={() => router.push(sharePageHref(folder.linkId))}
        onMenu={(anchor) => menu.toggle(folder.id, anchor)}
        menuOpen={menu.isOpenFor(folder.id)}
        upDrop={parentOfCurrent ? drag.dropProps(parentOfCurrent.id) : undefined}
        upOver={parentOfCurrent !== undefined && drag.over === parentOfCurrent.id}
      />
      <Toolbar
        allSelected={selection.allSelected}
        selectedCount={selectedItems.length}
        onToggleAll={selection.toggleAll}
        selectionActions={toolbar.selection}
        folderActions={toolbar.folder}
        view={prefs.view}
        onToggleView={() => setPrefs({ view: prefs.view === "grid" ? "list" : "grid" })}
        onToggleSearch={search.toggleSearch}
        sort={prefs.sort}
        sortOptions={FILE_SORT_OPTIONS}
        onSort={(sort) => setPrefs({ sort })}
        onRefresh={refresh}
      />
      <ListChrome
        search={search}
        counts={counts}
        showFilters={children.length > 0}
        onFilter={(key) => (search.setFilter(key), clearSelection())}
        tagMode={tagMode}
        wanted={wanted}
        matched={items.length}
      />
      <FileList
        items={items}
        view={prefs.view}
        itemProps={itemProps}
        emptyTitle={searchError ?? emptyTitle({ tagMode, wanted, query: q, filter: search.filter })}
        emptyActions={toolbar.empty}
        onOpen={openItem}
        onDownload={media.download}
        onDropFiles={dropFiles}
        leading={isRoot && !nav && !tagMode && !q ? <FavoritesEntry count={view.favoriteCount ?? 0} /> : undefined}
      />
      {menu.menu && menuItem && (
        <ActionMenu
          anchor={menu.menu.anchor}
          label={`Actions for ${menuItem.name}`}
          entries={buildMenu(NODE_MENU, menuItem, { isRoot: menuItem.id === folder.id && isRoot, isAdmin }, actionsFor(menuItem))}
          onClose={menu.close}
        />
      )}
      <PropertiesDialog
        nodeId={propertiesFor}
        onClose={() => setPropertiesFor(null)}
        linkOf={linkOf}
        onCopyLink={copyLink}
        onEditTags={(id) => withItem(id, (item) => (setPropertiesFor(null), actionsFor(item).tags?.()))}
        onZip={(id) => withItem(id, (item) => media.zip([item]))}
        onEditSettings={(id) => withItem(id, (item) => (setPropertiesFor(null), actionsFor(item).settings?.()))}
      />
      {media.viewer}
      {newFolder.dialog}
      {dialogs}
      {folderTools.dialogs}
      {drag.pill}
    </>
  );
}
