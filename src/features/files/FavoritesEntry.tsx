import Link from "next/link";
import { itemCount } from "@/domain/tree";
import { favoritesHref } from "@/shared/lib/routes";
import { Icon } from "@/shared/ui/icon/Icon";

/** "Favorites" at the top of the root folder: a virtual folder listing favorite items where they are. */
export function FavoritesEntry({ count }: { count: number }) {
  return (
    <Link href={favoritesHref()} data-entry="Favorites" className="flex items-center gap-3 bg-card px-4 py-3 text-inherit no-underline">
      <span className="flex size-10 shrink-0 items-center justify-center sm:size-[30px]" />
      <span className="flex w-9 shrink-0 justify-center">
        <Icon name="star" weight="fill" size={28} className="text-warn-strong" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="truncate text-[15px] font-bold">Favorites</span>
        <span className="text-[13px] text-t4">{itemCount(count)}</span>
      </span>
      <Icon name="caret-right" size={16} className="shrink-0 text-t5" />
    </Link>
  );
}
