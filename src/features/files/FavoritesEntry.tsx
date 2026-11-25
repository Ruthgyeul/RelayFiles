import Link from "next/link";
import type { Route } from "next";
import { NAV_ITEM_ATTR } from "./useListKeyboard";
import { plural } from "@/domain/format";
import { itemCount } from "@/domain/tree";
import { allFilesHref, favoritesHref } from "@/shared/lib/routes";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";

interface RootEntryProps {
  /** Keyboard navigation id (not an item: Space selects nothing). */
  navId: string;
  href: Route;
  name: string;
  icon: IconName;
  iconClass: string;
  detail: string;
}

/** A virtual folder at the top of the root folder (Favorites, All Files), styled like a folder row. */
function RootEntry({ navId, href, name, icon, iconClass, detail }: RootEntryProps) {
  return (
    <Link href={href} data-entry={name} {...{ [NAV_ITEM_ATTR]: navId }} className="flex items-center gap-3 bg-card px-4 py-3 text-inherit no-underline">
      <span className="flex size-10 shrink-0 items-center justify-center sm:size-[30px]" />
      <span className="flex w-9 shrink-0 justify-center">
        <Icon name={icon} weight="fill" size={28} className={iconClass} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="truncate text-[15px] font-bold">{name}</span>
        <span className="text-[13px] text-t4">{detail}</span>
      </span>
      <Icon name="caret-right" size={16} className="shrink-0 text-t5" />
    </Link>
  );
}

/** "Favorites" at the top of the root folder: a virtual folder listing favorite items where they are. */
export function FavoritesEntry({ count }: { count: number }) {
  return <RootEntry navId="favorites" href={favoritesHref()} name="Favorites" icon="star" iconClass="text-warn-strong" detail={itemCount(count)} />;
}

/** "All Files" under Favorites: every file of the account in one list, without folders. */
export function AllFilesEntry({ count }: { count: number }) {
  return <RootEntry navId="all-files" href={allFilesHref()} name="All Files" icon="files" iconClass="text-accent-icon" detail={plural(count, "file")} />;
}
