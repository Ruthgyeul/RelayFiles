"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FolderView, NodeItem } from "@/contracts/nodes";
import { parseTags } from "@/domain/tags";
import { emptyTitle, itemCount, type FilterKey } from "@/domain/tree";
import { usePageTitle } from "@/features/shell/page-title";
import { useShell } from "@/features/shell/ShellProvider";
import { entriesFromDrop, hasFiles } from "@/features/transfers/read-drop";
import { useTransfers } from "@/features/transfers/TransfersProvider";
import { useNow } from "@/shared/hooks/useNow";
import { cn } from "@/shared/lib/cn";
import { ApiClientError } from "@/shared/lib/api-client";
import { ActionMenu, anchorOf, type AnchorRect } from "./ActionMenu";
import { filesApi } from "./api";
import { FilterBar } from "./FilterBar";
import { FolderHeader } from "./FolderHeader";
import { EmptyFolder, NodeCard } from "./NodeCard";
import { buildNodeMenu, type NodeActions } from "./node-menu";
import { NodeRow, RowButton, type ItemProps } from "./NodeRow";
import { PathBar } from "./PathBar";
import { folderHref } from "./paths";
import { PropertiesDialog } from "./PropertiesDialog";
import { SearchBox, TagModeBar } from "./SearchBox";
import { Toolbar, ToolButton } from "./Toolbar";
import { useDragMove } from "./useDragMove";
import { useFileDialogs } from "./useFileDialogs";
import { useFileShortcuts } from "./useFileShortcuts";
import { useFolderItems, type ListedItem } from "./useFolderItems";
import { useNewFolder } from "./useNewFolder";
import { usePrefs } from "./usePrefs";

/** Re-render interval for relative times ("Expires in 3h 12m"), as in the design. */
const CLOCK_TICK_MS = 30_000;

interface FileManagerProps {
  view: FolderView;
  isAdmin: boolean;
  publicUrl: string;
}

/** The File Manager page for one folder: path, header, toolbar, filters, search, items and dialogs. */
export function FileManager({ view, isAdmin, publicUrl }: FileManagerProps) {
  const router = useRouter();
  const { notify, activeAccount } = useShell();
  const [prefs, setPrefs] = usePrefs();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<{ id: string; anchor: AnchorRect } | null>(null);
  const [propertiesFor, setPropertiesFor] = useState<string | null>(null);
  const now = useNow(true, CLOCK_TICK_MS);
  usePageTitle(view.folder.name);

  const { folder, children, path, isRoot } = view;
  const parentRef = isRoot ? "root" : folder.id;
  const { items, counts, tagMode, wanted, q } = useFolderItems(children, filter, query, prefs.sort);
  const linkOf = (linkId: string) => `${publicUrl}/d/${linkId}`;
  const clearSelection = () => setSelected(new Set());
  const { open, dialogs } = useFileDialogs({ isAdmin, accountDeletesAt: activeAccount?.deletesAt ?? null, linkOf, onChanged: clearSelection });
  const newFolder = useNewFolder(parentRef, children.map((child) => child.name));

  const moveTo = (ids: string[], targetId: string) =>
    filesApi
      .transfer(ids, targetId, "move")
      .then((result) => {
        notify(`Moved ${itemCount(result.done)} to ${result.targetName}${result.renamed ? ` · renamed ${result.renamed} to avoid duplicates` : ""}`);
        clearSelection();
        router.refresh();
      })
      .catch((caught: unknown) => notify(caught instanceof ApiClientError ? caught.message : "Something went wrong."));
  const transfers = useTransfers();
  const uploadTarget = { ref: parentRef, name: folder.name };
  const dropFiles = async (folderId: string, transfer: DataTransfer) => {
    const target = folderId === folder.id ? uploadTarget : { ref: folderId, name: items.find((item) => item.id === folderId)?.name ?? folder.name };
    transfers.upload(await entriesFromDrop(transfer), target);
  };
  const drag = useDragMove(selected, moveTo, (folderId, transfer) => void dropFiles(folderId, transfer));
  const [filesOver, setFilesOver] = useState(false);

  const copyText = (text: string, message: string) => {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    notify(message);
  };
  const copyLink = (url: string, visibility: "private" | "public") => copyText(url, visibility === "public" ? "Link copied" : "Link copied · private, only you can open it");
  const visibilityOf = (item: NodeItem) => (item.settings.visibility === "inherit" ? view.effectiveVisibility : item.settings.visibility);
  const openItem = (item: NodeItem) => (item.type === "folder" ? router.push(folderHref(item.id)) : setPropertiesFor(item.id));
  const parentOfCurrent = path.at(-2);

  const actionsFor = (item: NodeItem): NodeActions => {
    const current = item.id === folder.id;
    const parentId = current ? (parentOfCurrent?.id ?? folder.id) : folder.id;
    const parentVisibility = current ? view.parentVisibility : view.effectiveVisibility;
    return {
      open: item.type === "folder" && !current ? () => router.push(folderHref(item.id)) : undefined,
      tags: () => open.tags([item]),
      directLink: () => copyLink(linkOf(item.linkId), current ? view.effectiveVisibility : visibilityOf(item)),
      newLink: () => open.newLink(item),
      activity: () => open.activity(item),
      settings: () => open.settings(item, current && isRoot, parentVisibility),
      togglePause: isAdmin ? () => void open.togglePause(item) : undefined,
      rename: () => open.rename(item),
      copy: () => open.move([item], "copy", parentId),
      move: () => open.move([item], "move", parentId),
      delete: () => open.remove([item]),
      properties: () => setPropertiesFor(item.id),
    };
  };

  useFileShortcuts({
    upload: () => transfers.pickFiles(uploadTarget),
    selectAll: () => setSelected(new Set(items.map((item) => item.id))),
    search: () => setSearchOpen(true),
    toggleView: () => setPrefs({ view: prefs.view === "grid" ? "list" : "grid" }),
    parent: () => parentOfCurrent && router.push(folderHref(parentOfCurrent.id, path.length === 2)),
  });

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectedItems = items.filter((item) => selected.has(item.id));
  const menuItem = menu && (menu.id === folder.id ? folder : items.find((item) => item.id === menu.id));
  const openMenu = (id: string, anchor: HTMLElement) => {
    const rect = anchorOf(anchor);
    setMenu((current) => (current?.id === id ? null : { id, anchor: rect }));
  };
  const searchTag = (tag: string) => {
    setSearchOpen(true);
    clearSelection();
    setQuery((current) => {
      const trimmed = current.trim();
      if (trimmed.startsWith("#") && parseTags(trimmed).includes(tag)) return trimmed;
      return trimmed.startsWith("#") ? `${trimmed} #${tag}` : `#${tag}`;
    });
  };

  const itemProps = (item: ListedItem): ItemProps => ({
    item,
    parentPath: item.parentPath,
    parentVisibility: view.effectiveVisibility,
    selected: selected.has(item.id),
    now,
    onToggle: () => toggle(item.id),
    onPrimary: () => openItem(item),
    onMenu: (anchor) => openMenu(item.id, anchor),
    onTag: searchTag,
    menuOpen: menu?.id === item.id,
    drag: tagMode ? undefined : drag.dragProps(item.id, item.name),
    drop: item.type === "folder" && !tagMode ? drag.dropProps(item.id) : undefined,
    dropOver: drag.over === item.id,
  });

  const newFolderButton = <ToolButton icon="folder-plus" label="New folder" onClick={newFolder.open} />;
  const folderActions = (
    <>
      <ToolButton variant="primary" icon="upload-simple" label="Upload" onClick={() => transfers.pickFiles(uploadTarget)} />
      <ToolButton icon="folder-simple-plus" label="Upload folder" title="Upload a folder" onClick={() => transfers.pickFolder(uploadTarget)} />
      {newFolderButton}
    </>
  );
  const emptyActions = (
    <>
      <ToolButton variant="primary" icon="upload-simple" label="Upload files" onClick={() => transfers.pickFiles(uploadTarget)} />
      {newFolderButton}
    </>
  );
  const selectionActions = (
    <>
      <ToolButton icon="tag" label="Tags" onClick={() => open.tags(selectedItems)} />
      <ToolButton icon="copy" label="Copy" onClick={() => open.move(selectedItems, "copy", folder.id)} />
      <ToolButton icon="arrow-bend-up-right" label="Move" onClick={() => open.move(selectedItems, "move", folder.id)} />
      <ToolButton icon="trash" label="Delete" danger onClick={() => open.remove(selectedItems)} />
    </>
  );

  return (
    <>
      <PathBar path={path} onCopyPath={(text) => copyText(text, "Path copied")} dropFor={drag.dropProps} over={drag.over} />
      <FolderHeader
        view={view}
        now={now}
        onShare={() => copyLink(linkOf(folder.linkId), view.effectiveVisibility)}
        onMenu={(anchor) => openMenu(folder.id, anchor)}
        menuOpen={menu?.id === folder.id}
        upDrop={parentOfCurrent ? drag.dropProps(parentOfCurrent.id) : undefined}
        upOver={parentOfCurrent !== undefined && drag.over === parentOfCurrent.id}
      />
      <Toolbar
        allSelected={items.length > 0 && items.every((item) => selected.has(item.id))}
        selectedCount={selectedItems.length}
        onToggleAll={() => setSelected(items.length > 0 && items.every((item) => selected.has(item.id)) ? new Set() : new Set(items.map((item) => item.id)))}
        selectionActions={selectionActions}
        folderActions={folderActions}
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
      <div
        onDragOver={(event) => {
          if (!hasFiles(event.dataTransfer)) return;
          event.preventDefault();
          setFilesOver(true);
        }}
        onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget as Node | null) && setFilesOver(false)}
        onDrop={(event) => {
          setFilesOver(false);
          if (!hasFiles(event.dataTransfer)) return;
          event.preventDefault();
          void dropFiles(folder.id, event.dataTransfer);
        }}
        className={cn("flex flex-col gap-px overflow-hidden rounded-2xl border bg-card-line", filesOver ? "border-accent-hi" : "border-card-line")}
      >
        {items.length === 0 ? (
          <EmptyFolder title={emptyTitle({ tagMode, wanted, query: q, filter })} actions={emptyActions} />
        ) : prefs.view === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(160px,100%),1fr))] gap-3 bg-card p-3.5">
            {items.map((item) => (
              <NodeCard key={item.id} {...itemProps(item)} />
            ))}
          </div>
        ) : (
          items.map((item) => (
            <NodeRow key={item.id} {...itemProps(item)} actions={item.type === "folder" ? <RowButton icon="folder-open" label="Open" onClick={() => openItem(item)} /> : null} />
          ))
        )}
      </div>
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
        onEditTags={(id) => {
          const item = id === folder.id ? folder : items.find((entry) => entry.id === id);
          setPropertiesFor(null);
          if (item) open.tags([item]);
        }}
        onEditSettings={(id) => {
          const item = id === folder.id ? folder : items.find((entry) => entry.id === id);
          setPropertiesFor(null);
          if (item) open.settings(item, item.id === folder.id && isRoot, item.id === folder.id ? view.parentVisibility : view.effectiveVisibility);
        }}
      />
      {newFolder.dialog}
      {dialogs}
      {drag.pill}
    </>
  );
}
