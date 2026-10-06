"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FolderView, NodeItem } from "@/contracts/nodes";
import { uniqName } from "@/domain/names";
import { hasAllTags, parseTags } from "@/domain/tags";
import { emptyTitle, FILTER_KEYS, itemCount, matchesFilter, sortNodes, type FilterKey } from "@/domain/tree";
import { usePageTitle } from "@/features/shell/page-title";
import { useShell } from "@/features/shell/ShellProvider";
import { useNow } from "@/shared/hooks/useNow";
import { ApiClientError } from "@/shared/lib/api-client";
import { PromptDialog } from "@/shared/ui/PromptDialog";
import { ActionMenu, anchorOf, type AnchorRect } from "./ActionMenu";
import { filesApi } from "./api";
import { FilterBar } from "./FilterBar";
import { FolderHeader } from "./FolderHeader";
import { EmptyFolder, NodeCard } from "./NodeCard";
import { buildNodeMenu, type NodeActions } from "./node-menu";
import { NodeRow, RowButton } from "./NodeRow";
import { PathBar } from "./PathBar";
import { folderHref } from "./paths";
import { PropertiesDialog } from "./PropertiesDialog";
import { SearchBox, TagModeBar } from "./SearchBox";
import { toSortable } from "./settings";
import { Toolbar, ToolButton } from "./Toolbar";
import { useFileShortcuts } from "./useFileShortcuts";
import { usePrefs } from "./usePrefs";
import { useTagSearch } from "./useTagSearch";

/** Re-render interval for relative times ("Expires in 3h 12m"), as in the design. */
const CLOCK_TICK_MS = 30_000;

interface FileManagerProps {
  view: FolderView;
  isAdmin: boolean;
  publicUrl: string;
}

type OpenMenu = { id: string; anchor: AnchorRect } | null;

/** The File Manager page for one folder: path, header, toolbar, filters, search and items. */
export function FileManager({ view, isAdmin, publicUrl }: FileManagerProps) {
  const router = useRouter();
  const { notify } = useShell();
  const [prefs, setPrefs] = usePrefs();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<OpenMenu>(null);
  const [propertiesFor, setPropertiesFor] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<{ initial: string; error?: string } | null>(null);
  const now = useNow(true, CLOCK_TICK_MS);
  usePageTitle(view.folder.name);

  const q = query.trim().toLowerCase();
  const { tagMode, wanted, results } = useTagSearch(query);

  const children = view.children;
  const counts = useMemo(
    () => Object.fromEntries(FILTER_KEYS.map((key) => [key, children.filter((child) => matchesFilter(child, key)).length])) as Record<FilterKey, number>,
    [children],
  );
  const items: (NodeItem & { parentPath?: string })[] = useMemo(() => {
    const source = tagMode
      ? results.filter((item) => hasAllTags(item.tags, wanted) && matchesFilter(item, filter))
      : children.filter((child) => matchesFilter(child, filter) && (!q || child.name.toLowerCase().includes(q)));
    return sortNodes(source.map(toSortable), prefs.sort).map((entry) => entry.item);
  }, [tagMode, results, wanted, filter, children, q, prefs.sort]);

  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  const linkOf = (linkId: string) => `${publicUrl}/d/${linkId}`;
  const copyText = (text: string, message: string) => {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    notify(message);
  };
  const copyLink = (url: string, visibility: "private" | "public") => copyText(url, visibility === "public" ? "Link copied" : "Link copied · private, only you can open it");
  const visibilityOf = (item: NodeItem) => (item.settings.visibility === "inherit" ? view.effectiveVisibility : item.settings.visibility);
  const openItem = (item: NodeItem) => (item.type === "folder" ? router.push(folderHref(item.id)) : setPropertiesFor(item.id));
  const searchTag = (tag: string) => {
    setSearchOpen(true);
    setSelected(new Set());
    setQuery((current) => {
      const trimmed = current.trim();
      if (trimmed.startsWith("#") && parseTags(trimmed).includes(tag)) return trimmed;
      return trimmed.startsWith("#") ? `${trimmed} #${tag}` : `#${tag}`;
    });
  };

  const actionsFor = (item: NodeItem, isRoot: boolean): NodeActions => ({
    open: item.type === "folder" && !isRoot ? () => router.push(folderHref(item.id)) : undefined,
    directLink: () => copyLink(linkOf(item.linkId), isRoot || item.id === view.folder.id ? view.effectiveVisibility : visibilityOf(item)),
    properties: () => setPropertiesFor(item.id),
  });

  const openNewFolder = () => setNewFolder({ initial: uniqName(children.map((child) => child.name), "New folder", false) });
  const createFolder = async (name: string) => {
    try {
      const created = await filesApi.createFolder(view.isRoot ? "root" : view.folder.id, name);
      setNewFolder(null);
      if (created.renamed) notify(`"${created.requestedName}" already exists · created "${created.folder.name}"`);
      router.refresh();
    } catch (caught) {
      setNewFolder((current) => current && { ...current, error: caught instanceof ApiClientError ? caught.message : "Something went wrong." });
    }
  };

  useFileShortcuts({
    selectAll: () => setSelected(new Set(items.map((item) => item.id))),
    search: () => setSearchOpen(true),
    toggleView: () => setPrefs({ view: prefs.view === "grid" ? "list" : "grid" }),
    parent: () => {
      const parent = view.path.at(-2);
      if (parent) router.push(folderHref(parent.id, view.path.length === 2));
    },
  });

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const menuItem = menu && (menu.id === view.folder.id ? view.folder : items.find((item) => item.id === menu.id));
  const menuEntries = menuItem ? buildNodeMenu(menuItem, menuItem.id === view.folder.id && view.isRoot, isAdmin, actionsFor(menuItem, menuItem.id === view.folder.id && view.isRoot)) : [];
  const openMenu = (id: string, anchor: HTMLElement) => {
    const rect = anchorOf(anchor);
    setMenu((current) => (current?.id === id ? null : { id, anchor: rect }));
  };

  const itemProps = (item: NodeItem & { parentPath?: string }) => ({
    item,
    parentPath: item.parentPath,
    parentVisibility: view.effectiveVisibility,
    selected: selected.has(item.id),
    now,
    onToggle: () => toggle(item.id),
    onPrimary: () => openItem(item),
    onMenu: (anchor: HTMLElement) => openMenu(item.id, anchor),
    onTag: searchTag,
    menuOpen: menu?.id === item.id,
  });

  const newFolderButton = <ToolButton icon="folder-plus" label="New folder" onClick={openNewFolder} />;

  return (
    <>
      <PathBar path={view.path} onCopyPath={(path) => copyText(path, "Path copied")} />
      <FolderHeader
        view={view}
        now={now}
        onShare={() => copyLink(linkOf(view.folder.linkId), view.effectiveVisibility)}
        onMenu={(anchor) => openMenu(view.folder.id, anchor)}
        menuOpen={menu?.id === view.folder.id}
      />
      <Toolbar
        allSelected={allSelected}
        selectedCount={selected.size}
        onToggleAll={() => setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)))}
        selectionActions={null}
        folderActions={newFolderButton}
        view={prefs.view}
        onToggleView={() => setPrefs({ view: prefs.view === "grid" ? "list" : "grid" })}
        onToggleSearch={() => {
          setSearchOpen((open) => !open);
          setQuery("");
        }}
        sort={prefs.sort}
        onSort={(sort) => setPrefs({ sort })}
        onRefresh={() => {
          router.refresh();
          notify("Up to date");
        }}
      />
      {children.length > 0 && (
        <FilterBar
          counts={counts}
          value={filter}
          onChange={(key) => {
            setFilter(key);
            setSelected(new Set());
          }}
        />
      )}
      {searchOpen && <SearchBox value={query} onChange={setQuery} />}
      {tagMode && (
        <TagModeBar
          label={wanted.length ? wanted.map((tag) => `#${tag}`).join(" + ") : "Type a tag after #"}
          count={itemCount(items.length)}
          onClear={() => {
            setQuery("");
            setSearchOpen(false);
          }}
        />
      )}
      <div className="flex flex-col gap-px overflow-hidden rounded-2xl border border-card-line bg-card-line">
        {items.length === 0 ? (
          <EmptyFolder title={emptyTitle({ tagMode, wanted, query: q, filter })} actions={newFolderButton} />
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
      {menu && menuItem && <ActionMenu anchor={menu.anchor} label={`Actions for ${menuItem.name}`} entries={menuEntries} onClose={() => setMenu(null)} />}
      <PropertiesDialog nodeId={propertiesFor} onClose={() => setPropertiesFor(null)} linkOf={linkOf} onCopyLink={copyLink} />
      {newFolder && (
        <PromptDialog
          open
          title="New folder"
          icon="folder-plus"
          iconColor="var(--color-kind-folder)"
          initialValue={newFolder.initial}
          confirmLabel="Create"
          error={newFolder.error}
          onSubmit={(name) => void createFolder(name)}
          onCancel={() => setNewFolder(null)}
        />
      )}
    </>
  );
}
