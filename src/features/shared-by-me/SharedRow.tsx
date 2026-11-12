"use client";

import Link from "next/link";
import type { Route } from "next";
import type { SharedItem } from "@/contracts/shares";
import { formatDateTime } from "@/domain/format";
import { settingTags } from "@/domain/tree";
import { toShareSettings } from "@/features/files/settings";
import { folderHref } from "@/shared/lib/routes";
import { Icon } from "@/shared/ui/icon/Icon";
import { LocalDate } from "@/shared/ui/LocalDate";
import { Tag } from "@/shared/ui/Tag";
import { kindOf } from "@/shared/ui/node-kind";

const iconButton = "flex size-8 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent p-0 text-t3 no-underline hover:bg-btn hover:text-t3";

/** Where the item is: a folder opens itself, a file opens in its folder's viewer. */
function showHref(item: SharedItem): Route {
  if (item.type === "folder") return folderHref(item.id);
  return `${folderHref(item.parentId, item.parentIsRoot)}?view=${item.id}` as Route;
}

interface SharedRowProps {
  item: SharedItem;
  selected: boolean;
  now: number;
  onToggle: () => void;
  onCopy: () => void;
  onMakePrivate: () => void;
}

/** One shared item: checkbox, name and place, its share settings, downloads, last use and actions. */
export function SharedRow({ item, selected, now, onToggle, onCopy, onMakePrivate }: SharedRowProps) {
  const kind = kindOf(item);
  // Everything listed is open from outside, so "Public" says nothing here.
  const tags = settingTags(toShareSettings(item.settings), item.downloads, null, now).filter((tag) => tag.icon !== "globe-simple");
  return (
    <li className="flex items-start gap-2.5 border-t border-ctrl py-2.5 first:border-t-0">
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select ${item.name}`}
        onClick={onToggle}
        className="flex size-[30px] shrink-0 items-center justify-center border-0 bg-transparent p-0"
      >
        <Icon name={selected ? "check-square" : "square"} weight={selected ? "fill" : "regular"} size={20} className={selected ? "text-accent-hi" : "text-t5"} />
      </button>
      <Icon name={kind.icon} weight={item.type === "folder" ? "fill" : "regular"} size={20} className="mt-[5px] shrink-0" style={{ color: kind.color }} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-semibold" title={item.name}>
          {item.name}
        </span>
        <span className="truncate text-[12px] text-t4">{item.parentPath}</span>
        {tags.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Tag key={tag.label} size="sm" icon={tag.icon}>
                {tag.label}
              </Tag>
            ))}
          </div>
        )}
        <span className="text-[12px] text-t4">
          {item.type === "folder" ? `${item.fileCount} ${item.fileCount === 1 ? "file" : "files"} inside · ` : ""}
          {item.downloads} {item.downloads === 1 ? "download" : "downloads"} ·{" "}
          {item.lastActivityAt ? (
            <>
              Last opened <LocalDate value={item.lastActivityAt} format={formatDateTime} />
            </>
          ) : (
            "Not opened yet"
          )}
        </span>
      </div>
      <div className="flex shrink-0 items-center">
        <button type="button" title="Copy link" aria-label={`Copy the link to ${item.name}`} onClick={onCopy} className={iconButton}>
          <Icon name="link-simple" size={18} />
        </button>
        <Link href={showHref(item)} title="Show in folder" aria-label={`Show ${item.name} in its folder`} className={iconButton}>
          <Icon name="arrow-up-right" size={18} />
        </Link>
        <button type="button" title="Make private" aria-label={`Make ${item.name} private`} onClick={onMakePrivate} className={iconButton}>
          <Icon name="lock-simple" size={18} />
        </button>
      </div>
    </li>
  );
}
