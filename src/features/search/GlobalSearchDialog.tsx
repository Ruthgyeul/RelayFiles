"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SEARCH } from "@/config/policy";
import type { TaggedItem } from "@/contracts/nodes";
import { formatSize } from "@/domain/format";
import { moveHighlight, parseSearchQuery, searchHeading } from "@/domain/search";
import { folderHref } from "@/features/files/paths";
import { kindOf } from "@/features/files/kind";
import { cn } from "@/shared/lib/cn";
import { Icon } from "@/shared/ui/icon/Icon";
import { Modal } from "@/shared/ui/Modal";
import { useGlobalSearch } from "./useGlobalSearch";

/** Opens a folder, or a file's folder with the file in the viewer (`?view=`). */
export function searchHitHref(item: TaggedItem): string {
  if (item.type === "folder") return folderHref(item.id);
  const folder = folderHref(item.parentId, item.parentIsRoot);
  return item.kind && item.kind !== "other" ? `${folder}?view=${item.id}` : folder;
}

/** Global search (design `gsOpen`): every file and folder of the active account. */
export function GlobalSearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const { results, loading } = useGlobalSearch(query, open);
  const index = Math.min(highlight, Math.max(0, results.length - 1));
  const heading = searchHeading(parseSearchQuery(query), results.length);

  const pick = (item: TaggedItem) => {
    onClose();
    router.push(searchHitHref(item) as Parameters<typeof router.push>[0]);
  };

  return (
    <Modal open={open} onClose={onClose} width={620} layer="search" position="top" label="Search all files" className="max-h-[min(70vh,560px)] overflow-hidden shadow-search">
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-card-line px-3.5">
        <Icon name="magnifying-glass" size={20} className="text-t3" />
        <input
          autoFocus
          value={query}
          maxLength={SEARCH.maxQueryLength}
          aria-label="Search all files and folders"
          aria-controls="global-search-results"
          aria-activedescendant={results[index] ? `search-hit-${results[index].id}` : undefined}
          placeholder="Search all files and folders"
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setHighlight(moveHighlight(index, event.key, results.length));
            } else if (event.key === "Enter" && results[index]) {
              pick(results[index]);
            }
          }}
          className="min-w-0 flex-1 border-0 bg-transparent text-[16px] text-t1 outline-none placeholder:text-t5"
        />
        <span className="rounded-md border border-ctrl px-1.5 py-0.5 font-mono text-[11px] font-semibold text-t4">Esc</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <span className="block px-2.5 py-1.5 text-[11px] font-extrabold tracking-[.06em] text-t4 uppercase">{loading ? "Searching…" : heading}</span>
        <div id="global-search-results" role="listbox" aria-label="Results">
          {results.map((item, i) => {
            const kind = kindOf(item);
            return (
              <div
                key={item.id}
                id={`search-hit-${item.id}`}
                role="option"
                aria-selected={i === index}
                onClick={() => pick(item)}
                onMouseEnter={() => setHighlight(i)}
                className={cn("box-border flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-[9px]", i === index && "bg-accent-soft")}
              >
                <Icon name={kind.icon} weight={item.type === "folder" ? "fill" : "regular"} size={22} style={{ color: kind.color }} />
                <div className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-[14px] font-bold">{item.name}</span>
                  <span className="truncate text-[12px] text-t4">{item.parentPath}</span>
                </div>
                <span className="shrink-0 text-[12px] text-t4">{item.type === "folder" ? `${item.itemCount} items` : formatSize(Number(item.size))}</span>
              </div>
            );
          })}
        </div>
        {!loading && results.length === 0 && <div className="px-3 py-8 text-center text-[14px] text-t4">No files or folders match.</div>}
      </div>
      <div className="flex shrink-0 gap-3.5 border-t border-card-line px-3.5 py-2.5 text-[12px] text-t4">
        <span>↑ ↓ to move</span>
        <span>Enter to open</span>
        <span>Esc to close</span>
      </div>
    </Modal>
  );
}
