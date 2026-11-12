"use client";

import Link from "next/link";
import type { Route } from "next";
import type { TaggedItem } from "@/contracts/nodes";
import { formatSize } from "@/domain/format";
import { folderHref } from "@/shared/lib/routes";
import { Icon } from "@/shared/ui/icon/Icon";

/** The file opened in its folder's viewer. */
const showHref = (item: TaggedItem) => `${folderHref(item.parentId, item.parentIsRoot)}?view=${item.id}` as Route;

interface StorageFileListProps {
  label: string;
  items: TaggedItem[];
  empty: string;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
}

/** A list of files with their folder and size, a checkbox each and a link to see it in its folder. */
export function StorageFileList({ label, items, empty, selected, onToggle }: StorageFileListProps) {
  if (items.length === 0) return <span className="py-6 text-center text-[13px] text-t4">{empty}</span>;
  return (
    <ol aria-label={label} className="m-0 flex list-none flex-col p-0">
      {items.map((item) => {
        const checked = selected.has(item.id);
        return (
          <li key={item.id} className="flex items-center gap-2.5 border-t border-ctrl py-2 first:border-t-0">
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-label={`Select ${item.name}`}
              onClick={() => onToggle(item.id)}
              className="flex size-[30px] shrink-0 items-center justify-center border-0 bg-transparent p-0"
            >
              <Icon name={checked ? "check-square" : "square"} weight={checked ? "fill" : "regular"} size={20} className={checked ? "text-accent-hi" : "text-t5"} />
            </button>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[14px] font-semibold" title={item.name}>
                {item.name}
              </span>
              <span className="truncate text-[12px] text-t4">{item.parentPath}</span>
            </div>
            <span className="shrink-0 text-[13px] text-t2">{formatSize(Number(item.size))}</span>
            <Link
              href={showHref(item)}
              title="Show in folder"
              aria-label={`Show ${item.name} in its folder`}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-t3 no-underline hover:bg-btn hover:text-t3"
            >
              <Icon name="arrow-up-right" size={18} />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
