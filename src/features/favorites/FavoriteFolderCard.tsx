import Link from "next/link";
import type { FavoriteFolderDto } from "@/contracts/favorites";
import { itemCount } from "@/domain/tree";
import { MenuButton } from "@/features/files/ItemButtons";
import { favoritesHref } from "@/shared/lib/routes";
import { Icon } from "@/shared/ui/icon/Icon";

interface Props {
  folder: FavoriteFolderDto;
  menuOpen: boolean;
  onMenu: (anchor: HTMLElement) => void;
}

/** An organizing folder in the Favorites grid: the item card's 4:3 area, name, count and menu. */
export function FavoriteFolderCard({ folder, menuOpen, onMenu }: Props) {
  return (
    <div data-entry={folder.name} className="relative flex flex-col overflow-hidden rounded-xl border border-card-line bg-sunk">
      <Link href={favoritesHref(folder.id)} aria-label={folder.name} className="relative flex aspect-[4/3] items-center justify-center bg-bg text-inherit no-underline">
        <span className="relative flex">
          <Icon name="folder-simple" weight="fill" size={48} className="text-t3" />
          <Icon name="star" weight="fill" size={20} className="absolute -right-1 -bottom-1 text-warn-strong" />
        </span>
      </Link>
      <div className="flex items-center gap-1 py-2.5 pr-1.5 pl-3">
        <Link href={favoritesHref(folder.id)} tabIndex={-1} className="flex min-w-0 flex-1 flex-col gap-0.5 text-inherit no-underline">
          <span className="truncate text-[14px] font-bold">{folder.name}</span>
          <span className="truncate text-[12px] text-t4">{itemCount(folder.itemCount)}</span>
        </Link>
        <MenuButton label={`Actions for ${folder.name}`} open={menuOpen} onMenu={onMenu} />
      </div>
    </div>
  );
}
