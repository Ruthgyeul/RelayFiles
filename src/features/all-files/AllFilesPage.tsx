"use client";

import { useState } from "react";
import type { AllFilesPage as AllFilesData } from "@/contracts/all-files";
import type { TaggedItem } from "@/contracts/nodes";
import { ALL_FILES_SORT_KEYS, ALL_FILES_SORT_OPTION_LABEL, ALL_FILES_SORT_SHORT_LABEL, type AllFilesSort } from "@/domain/all-files";
import { plural } from "@/domain/format";
import { parseTags } from "@/domain/tags";
import { emptyTitle } from "@/domain/tree";
import { ActionMenu, anchorOf, type AnchorRect } from "@/features/files/ActionMenu";
import { FileList } from "@/features/files/FileList";
import { ListChrome } from "@/features/files/ListChrome";
import { ALL_FILES_MENU, ALL_FILES_TOOLBAR, buildMenu, toolbarButtons } from "@/features/files/item-actions";
import type { ItemProps } from "@/features/files/item-props";
import { PathBar } from "@/features/files/PathBar";
import { PropertiesDialog } from "@/features/files/PropertiesDialog";
import { ToolButton, Toolbar, type SortOptions } from "@/features/files/Toolbar";
import { useFileSearch } from "@/features/files/useFileSearch";
import { useFileShortcuts } from "@/features/files/useFileShortcuts";
import { useFolderTools } from "@/features/files/useFolderTools";
import { useListPage } from "@/features/files/useListPage";
import { useViewPrefs, type ViewPrefs } from "@/features/files/usePrefs";
import { allFilesHref, folderHref } from "@/shared/lib/routes";
import { Button } from "@/shared/ui/Button";
import { allFilesActions } from "./all-files-actions";
import { useAllFiles } from "./useAllFiles";

/** View and sort of All Files, remembered apart from the File Manager's. */
const PREFS_KEY = "relay.allFilesView";
const DEFAULT_PREFS: ViewPrefs<AllFilesSort> = { view: "list", sort: "date" };
const SORT_OPTIONS: SortOptions<AllFilesSort> = { keys: ALL_FILES_SORT_KEYS, label: ALL_FILES_SORT_OPTION_LABEL, short: ALL_FILES_SORT_SHORT_LABEL };
const toolbarLook = toolbarButtons(ALL_FILES_TOOLBAR);

interface Props {
  initial: AllFilesData;
  isAdmin: boolean;
  initialView?: string;
}

/**
 * "All Files": every file of the account in one list, without folders, each with the folder it
 * is in. Sort, type filter and search run on the server (the list is read page by page), and
 * every action works on the file where it is, as in Favorites.
 */
export function AllFilesPage({ initial, isAdmin, initialView }: Props) {
  const [prefs, setPrefs] = useViewPrefs(PREFS_KEY, ALL_FILES_SORT_KEYS, DEFAULT_PREFS);
  const search = useFileSearch();
  const kind = search.filter === "folder" ? "all" : search.filter;
  const list = useAllFiles(initial, { sort: prefs.sort, kind, q: search.query });
  const items = list.items;
  const { router, now, selection, linkOf, media, files, copyLink, copyText, propertiesFor, setPropertiesFor, refresh } = useListPage({ items, title: "All Files", isAdmin, initialView });
  const folderTools = useFolderTools(selection.clear);
  const [menu, setMenu] = useState<{ id: string; anchor: AnchorRect } | null>(null);
  const byId = new Map(items.map((item) => [item.id, item]));
  const actionsFor = allFilesActions({ dialogs: files.open, folderTools: folderTools.open, media, linkOf, copyLink, onProperties: setPropertiesFor, push: router.push });
  const changed = <T,>(run: (value: T) => void) => (value: T) => (run(value), selection.clear());
  const toggleView = () => setPrefs({ view: prefs.view === "grid" ? "list" : "grid" });
  useFileShortcuts({ selectAll: selection.selectAll, search: search.openSearch, toggleView, parent: () => router.push(folderHref("root")) });

  const tagMode = search.query.trim().startsWith("#");
  const wanted = tagMode ? parseTags(search.query) : [];
  const counts = { folder: 0, ...(list.counts ?? { all: items.length, video: 0, audio: 0, image: 0, other: 0 }) };
  const selected = selection.items;
  const onSelection: Record<(typeof ALL_FILES_TOOLBAR)[number], () => void> = {
    download: () => (media.downloadEach(selected), selection.clear()),
    downloadZip: () => (media.zip(selected), selection.clear()),
    tags: () => files.open.tags(selected),
    toggleFavorite: () => void files.open.toggleFavorite(selected, true),
    shareCollection: () => folderTools.open.collection(selected),
    move: () => files.open.move(selected, "move", selected.map((item) => item.parentId)),
    delete: () => files.open.remove(selected),
  };

  const itemProps = (listed: { id: string }): ItemProps => {
    const item = byId.get(listed.id)!;
    return {
      item,
      parentPath: item.parentPath,
      parentVisibility: item.parentVisibility,
      selected: selection.has(item.id),
      now,
      onToggle: (range) => selection.toggle(item.id, range),
      onPrimary: () => media.preview(item),
      onPreview: () => media.preview(item),
      onMenu: (anchor) => setMenu((current) => (current?.id === item.id ? null : { id: item.id, anchor: anchorOf(anchor) })),
      onTag: changed(search.searchTag),
      menuOpen: menu?.id === item.id,
    };
  };
  const menuItem: TaggedItem | undefined = menu ? byId.get(menu.id) : undefined;
  const searching = tagMode || search.query.trim() !== "" || search.filter !== "all";
  const total = list.counts?.[kind];

  return (
    <>
      <PathBar path={[{ id: "root", name: "root" }, { id: "all", name: "All Files" }]} hrefOf={(index) => (index === 0 ? folderHref("root") : allFilesHref())} onCopyPath={(text) => copyText(text, "Path copied")} />
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <span className="truncate text-[22px] font-bold">All Files</span>
        <span className="text-[13px] text-t4">{total === undefined ? "Every file in your account, without folders" : `${plural(total, "file")} · every file in your account, without folders`}</span>
      </div>
      <Toolbar
        allSelected={selection.allSelected}
        selectedCount={selected.length}
        onToggleAll={selection.toggleAll}
        selectionActions={toolbarLook.map((button) => (
          <ToolButton key={button.id} icon={button.icon} label={button.label} title={button.title} danger={button.danger} onClick={onSelection[button.id]} />
        ))}
        folderActions={null}
        view={prefs.view}
        onToggleView={toggleView}
        onToggleSearch={search.toggleSearch}
        searchLabel="Search all files"
        sort={prefs.sort}
        sortOptions={SORT_OPTIONS}
        onSort={changed((sort: AllFilesSort) => setPrefs({ sort }))}
        links={false}
        onRefresh={refresh}
      />
      <ListChrome
        search={search}
        counts={counts}
        showFilters={counts.all > 0 || searching}
        onFilter={changed(search.setFilter)}
        tagMode={tagMode}
        wanted={wanted}
        matched={total ?? items.length}
        label="Search all files"
        placeholder="Search all files · #tag1 #tag2 for files with all tags"
        scope="in all files"
      />
      <FileList
        items={items}
        view={prefs.view}
        itemProps={itemProps}
        emptyTitle={list.error ?? (list.loading ? "Loading…" : searching ? emptyTitle({ tagMode, wanted, query: search.query.trim(), filter: search.filter }) : "No files yet")}
        emptyActions={searching ? undefined : <span className="text-[13px] text-t4">Files you upload in any folder show up here.</span>}
        onOpen={(listed) => {
          const item = byId.get(listed.id);
          if (item) media.preview(item);
        }}
        onDownload={(listed) => {
          const item = byId.get(listed.id);
          if (item) media.download(item);
        }}
      />
      {list.moreStatus === "error" && <p className="m-0 text-center text-[13px] text-t4">Couldn&apos;t load more files.</p>}
      {list.hasMore && (
        <Button size={36} hoverable disabled={list.moreStatus === "loading"} onClick={list.loadMore} className="self-center">
          {list.moreStatus === "error" ? "Try again" : "Load more"}
        </Button>
      )}
      {menu && menuItem && (
        <ActionMenu anchor={menu.anchor} label={`Actions for ${menuItem.name}`} entries={buildMenu(ALL_FILES_MENU, menuItem, { isRoot: false, isAdmin }, actionsFor(menuItem))} onClose={() => setMenu(null)} />
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
      {folderTools.dialogs}
    </>
  );
}
