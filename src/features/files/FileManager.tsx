"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FolderView, NodeItem } from "@/contracts/nodes";
import { withTagQuery } from "@/domain/tags";
import { emptyTitle, itemCount, type FilterKey } from "@/domain/tree";
import { usePageTitle } from "@/features/shell/usePageTitle";
import { useShell } from "@/features/shell/ShellProvider";
import { useTransfers } from "@/features/transfers/transfers-context";
import { useNow } from "@/shared/hooks/useNow";
import { ActionMenu, anchorOf, type AnchorRect } from "./ActionMenu";
import { FilterBar } from "./FilterBar";
import { FolderHeader } from "./FolderHeader";
import { buildNodeMenu } from "./node-menu";
import type { ItemProps } from "./item-props";
import { FileList } from "./FileList";
import { PathBar } from "./PathBar";
import { folderHref, sharePageHref } from "@/shared/lib/routes";
import { PropertiesDialog } from "./PropertiesDialog";
import { SearchBox, TagModeBar } from "./SearchBox";
import { Toolbar } from "./Toolbar";
import { toolbarActions } from "./ToolbarActions";
import { useFileDialogs } from "./useFileDialogs";
import { useFolderDrop } from "./useFolderDrop";
import { useFileMedia } from "./useFileMedia";
import { useFileShortcuts } from "./useFileShortcuts";
import { useFolderItems, type ListedItem } from "./useFolderItems";
import { useCopyLink } from "./useCopyLink";
import { useNewFolder } from "./useNewFolder";
import { useNodeActions } from "./useNodeActions";
import { useSelection } from "./useSelection";
import { usePrefs } from "./usePrefs";

/** Re-render interval for relative times ("Expires in 3h 12m"), as in the design. */
const CLOCK_TICK_MS = 30_000;

interface FileManagerProps {
  view: FolderView;
  isAdmin: boolean;
  publicUrl: string;
  /** A file of this folder to open in the viewer right away (global search `?view=`). */
  initialView?: string;
}

/** The File Manager page for one folder: path, header, toolbar, filters, search, items and dialogs. */
export function FileManager({ view, isAdmin, publicUrl, initialView }: FileManagerProps) {
  const router = useRouter();
  const { notify, activeAccount } = useShell();
  const [prefs, setPrefs] = usePrefs();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ id: string; anchor: AnchorRect } | null>(null);
  const [propertiesFor, setPropertiesFor] = useState<string | null>(null);
  const now = useNow(true, CLOCK_TICK_MS);
  usePageTitle(view.folder.name);

  const { folder, children, path, isRoot } = view;
  const parentRef = isRoot ? "root" : folder.id;
  const { items, counts, tagMode, wanted, q } = useFolderItems(children, filter, query, prefs.sort);
  const linkOf = (linkId: string) => `${publicUrl}/d/${linkId}`;
  const selection = useSelection(items);
  const clearSelection = selection.clear;
  const { open, dialogs } = useFileDialogs({ isAdmin, accountDeletesAt: activeAccount?.deletesAt ?? null, linkOf, onChanged: clearSelection });
  const newFolder = useNewFolder(parentRef, children.map((child) => child.name));
  const media = useFileMedia(items, folder.name, initialView);

  const transfers = useTransfers();
  const uploadTarget = { ref: parentRef, name: folder.name };
  const { drag, dropFiles } = useFolderDrop(folder, uploadTarget, items, selection.ids, clearSelection);

  const { copyText, copyLink } = useCopyLink();
  const actionsFor = useNodeActions({ view, isAdmin, dialogs: open, media, linkOf, copyLink, onProperties: setPropertiesFor });
  const openItem = (item: NodeItem) => (item.type === "folder" ? router.push(folderHref(item.id)) : media.preview(item));
  const parentOfCurrent = path.at(-2);

  useFileShortcuts({
    upload: () => transfers.pickFiles(uploadTarget),
    selectAll: selection.selectAll,
    search: () => setSearchOpen(true),
    toggleView: () => setPrefs({ view: prefs.view === "grid" ? "list" : "grid" }),
    parent: () => parentOfCurrent && router.push(folderHref(parentOfCurrent.id, path.length === 2)),
  });

  const selectedItems = selection.items;
  /** The current folder or one of its listed items. */
  const itemById = (id: string) => (id === folder.id ? folder : items.find((item) => item.id === id));
  const menuItem = menu && itemById(menu.id);
  const withItem = (id: string, run: (item: NodeItem) => void) => {
    const item = itemById(id);
    if (item) run(item);
  };
  const openMenu = (id: string, anchor: HTMLElement) => {
    const rect = anchorOf(anchor);
    setMenu((current) => (current?.id === id ? null : { id, anchor: rect }));
  };
  const searchTag = (tag: string) => {
    setSearchOpen(true);
    clearSelection();
    setQuery((current) => withTagQuery(current, tag));
  };

  const itemProps = (item: ListedItem): ItemProps => ({
    item,
    parentPath: item.parentPath,
    parentVisibility: view.effectiveVisibility,
    selected: selection.has(item.id),
    now,
    onToggle: () => selection.toggle(item.id),
    onPrimary: () => openItem(item),
    onPreview: () => media.preview(item),
    onMenu: (anchor) => openMenu(item.id, anchor),
    onTag: searchTag,
    menuOpen: menu?.id === item.id,
    drag: tagMode ? undefined : drag.dragProps(item.id, item.name),
    drop: item.type === "folder" && !tagMode ? drag.dropProps(item.id) : undefined,
    dropOver: drag.over === item.id,
  });

  const toolbar = toolbarActions({
    upload: () => transfers.pickFiles(uploadTarget),
    uploadFolder: () => transfers.pickFolder(uploadTarget),
    newFolder: newFolder.open,
    download: () => (media.downloadEach(selectedItems), clearSelection()),
    zip: () => (media.zip(selectedItems), clearSelection()),
    tags: () => open.tags(selectedItems),
    copy: () => open.move(selectedItems, "copy", folder.id),
    move: () => open.move(selectedItems, "move", folder.id),
    remove: () => open.remove(selectedItems),
  });

  return (
    <>
      <PathBar path={path} onCopyPath={(text) => copyText(text, "Path copied")} dropFor={drag.dropProps} over={drag.over} />
      <FolderHeader
        view={view}
        now={now}
        onShare={() => copyLink(linkOf(folder.linkId), view.effectiveVisibility)}
        onSharePage={() => router.push(sharePageHref(folder.linkId))}
        onMenu={(anchor) => openMenu(folder.id, anchor)}
        menuOpen={menu?.id === folder.id}
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
        onToggleSearch={() => {
          setSearchOpen((value) => !value);
          setQuery("");
        }}
        sort={prefs.sort}
        onSort={(sort) => setPrefs({ sort })}
        onRefresh={() => {
          router.refresh();
          notify("Up to date");
        }}
      />
      {children.length > 0 && <FilterBar counts={counts} value={filter} onChange={(key) => (setFilter(key), clearSelection())} />}
      {searchOpen && <SearchBox value={query} onChange={setQuery} />}
      {tagMode && (
        <TagModeBar
          label={wanted.length ? wanted.map((tag) => `#${tag}`).join(" + ") : "Type a tag after #"}
          count={itemCount(items.length)}
          onClear={() => (setQuery(""), setSearchOpen(false))}
        />
      )}
      <FileList
        items={items}
        view={prefs.view}
        itemProps={itemProps}
        emptyTitle={emptyTitle({ tagMode, wanted, query: q, filter })}
        emptyActions={toolbar.empty}
        onOpen={openItem}
        onDownload={media.download}
        onDropFiles={dropFiles}
      />
      {menu && menuItem && (
        <ActionMenu
          anchor={menu.anchor}
          label={`Actions for ${menuItem.name}`}
          entries={buildNodeMenu(menuItem, menuItem.id === folder.id && isRoot, isAdmin, actionsFor(menuItem))}
          onClose={() => setMenu(null)}
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
      {drag.pill}
    </>
  );
}
