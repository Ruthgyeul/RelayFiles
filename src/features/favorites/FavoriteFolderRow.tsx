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

/** An organizing folder inside Favorites (holds favorites only, nothing on disk). */
export function FavoriteFolderRow({ folder, menuOpen, onMenu }: Props) {
  return (
    <div data-entry={folder.name} className="flex items-center gap-3 bg-card px-4 py-3">
      <Link href={favoritesHref(folder.id)} className="flex min-w-0 flex-1 items-center gap-3 text-inherit no-underline">
        <span className="flex size-10 shrink-0 sm:size-[30px]" />
        <span className="relative flex w-9 shrink-0 justify-center">
          <Icon name="folder-simple" weight="fill" size={28} className="text-t3" />
          <Icon name="star" weight="fill" size={13} className="absolute -right-0.5 -bottom-0.5 text-warn-strong" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="truncate text-[15px] font-bold">{folder.name}</span>
          <span className="text-[13px] text-t4">{itemCount(folder.itemCount)}</span>
        </span>
      </Link>
      <MenuButton label={`Actions for ${folder.name}`} open={menuOpen} onMenu={onMenu} />
    </div>
  );
}
