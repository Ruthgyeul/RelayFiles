"use client";

import Link from "next/link";
import type { CollectionDto } from "@/contracts/collections";
import { settingTags, type SettingTag } from "@/domain/tree";
import { sharePageHref } from "@/shared/lib/routes";
import { Icon } from "@/shared/ui/icon/Icon";
import { Tag } from "@/shared/ui/Tag";

const iconButton = "flex size-8 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent p-0 text-t3 no-underline hover:bg-btn hover:text-t3";
/** Item names shown under a collection's name before "+ N more". */
const NAMES_SHOWN = 3;

/** A collection's settings as tags (a collection link closes; its items are not deleted). */
function collectionTags(collection: CollectionDto, now: number): SettingTag[] {
  const settings = {
    visibility: "inherit" as const,
    expiry: collection.expiry,
    expAt: collection.expAt ? Date.parse(collection.expAt) : null,
    burn: collection.burn,
    downloadLimit: collection.downloadLimit,
    hasPassword: collection.hasPassword,
    access: collection.access,
  };
  return settingTags(settings, collection.downloads, null, now).map((tag) => (tag.icon === "fire" ? { ...tag, label: "Closes after 1 download" } : tag));
}

function itemsText({ items }: CollectionDto): string {
  if (items.length === 0) return "No items left";
  const names = items.slice(0, NAMES_SHOWN).map((item) => item.name);
  const more = items.length - names.length;
  return `${items.length} ${items.length === 1 ? "item" : "items"} · ${names.join(", ")}${more > 0 ? ` + ${more} more` : ""}`;
}

interface CollectionRowProps {
  collection: CollectionDto;
  now: number;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** One collection link: name, its items, settings, downloads and actions. */
export function CollectionRow({ collection, now, onCopy, onEdit, onDelete }: CollectionRowProps) {
  const tags = collectionTags(collection, now);
  return (
    <li className="flex items-start gap-2.5 border-t border-ctrl py-2.5 first:border-t-0">
      <Icon name="stack" size={20} className="mt-[5px] shrink-0 text-accent-icon" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[14px] font-semibold" title={collection.name}>
          {collection.name}
        </span>
        <span className="truncate text-[12px] text-t4">{itemsText(collection)}</span>
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
          {collection.downloads} {collection.downloads === 1 ? "download" : "downloads"}
        </span>
      </div>
      <div className="flex shrink-0 items-center">
        <button type="button" title="Copy link" aria-label={`Copy the link to ${collection.name}`} onClick={onCopy} className={iconButton}>
          <Icon name="link-simple" size={18} />
        </button>
        <Link href={sharePageHref(collection.linkId)} title="Open share page" aria-label={`Open the share page of ${collection.name}`} className={iconButton}>
          <Icon name="arrow-up-right" size={18} />
        </Link>
        <button type="button" title="Settings" aria-label={`Settings of ${collection.name}`} onClick={onEdit} className={iconButton}>
          <Icon name="sliders-horizontal" size={18} />
        </button>
        <button type="button" title="Delete link" aria-label={`Delete the link ${collection.name}`} onClick={onDelete} className={iconButton}>
          <Icon name="trash" size={18} />
        </button>
      </div>
    </li>
  );
}
