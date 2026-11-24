"use client";

import type { SavedSearchDto } from "@/contracts/saved-searches";
import { Icon } from "@/shared/ui/icon/Icon";

interface SavedSearchListProps {
  saved: SavedSearchDto[];
  onPick: (query: string) => void;
  onDelete: (id: string) => void;
}

/** "Saved searches" above the recent files: a click runs one again, × deletes it. */
export function SavedSearchList({ saved, onPick, onDelete }: SavedSearchListProps) {
  if (saved.length === 0) return null;
  return (
    <section aria-label="Saved searches" className="mb-1.5">
      <span className="block px-2.5 py-1.5 text-[11px] font-extrabold tracking-[.06em] text-t4 uppercase">Saved searches</span>
      <ul className="m-0 list-none p-0">
        {saved.map((search) => (
          <li key={search.id} className="flex min-h-10 items-center gap-1 rounded-[10px] hover:bg-btn">
            <button type="button" onClick={() => onPick(search.query)} className="flex min-w-0 flex-1 items-center gap-3 border-0 bg-transparent px-2.5 py-2 text-left text-t2">
              <Icon name="bookmark-simple" size={18} className="shrink-0 text-t3" />
              <span className="truncate font-mono text-[13px]">{search.query}</span>
            </button>
            <button
              type="button"
              title="Delete saved search"
              aria-label={`Delete saved search ${search.query}`}
              onClick={() => onDelete(search.id)}
              className="mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent p-0 text-t4 hover:bg-card hover:text-t3"
            >
              <Icon name="x" size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
