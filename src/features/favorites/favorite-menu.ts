import type { FavoriteFolderDto } from "@/contracts/favorites";
import type { TaggedItem } from "@/contracts/nodes";
import type { MenuEntry } from "@/features/files/ActionMenu";
import { buildMenu, FAVORITE_MENU } from "@/features/files/item-actions";

/** What the Favorites page does with a favorite (it acts on the item itself, where it is). */
export interface FavoriteItemActions {
  open: (item: TaggedItem) => void;
  preview: (item: TaggedItem) => void;
  download: (item: TaggedItem) => void;
  showInFolder: (item: TaggedItem) => void;
  moveInFavorites: (item: TaggedItem) => void;
  unfavorite: (item: TaggedItem) => void;
  share: (item: TaggedItem) => void;
  tags: (item: TaggedItem) => void;
  activity: (item: TaggedItem) => void;
  rename: (item: TaggedItem) => void;
  remove: (item: TaggedItem) => void;
  properties: (item: TaggedItem) => void;
}

/** What the Favorites page does with an organizing folder. */
export interface FavoriteFolderActions {
  open: (folder: FavoriteFolderDto) => void;
  rename: (folder: FavoriteFolderDto) => void;
  move: (folder: FavoriteFolderDto) => void;
  remove: (folder: FavoriteFolderDto) => void;
}

/** The menu of a favorite (see `FAVORITE_MENU`): folders open and share, files preview. */
export function favoriteItemMenu(item: TaggedItem, run: FavoriteItemActions): MenuEntry[] {
  return buildMenu(
    FAVORITE_MENU,
    item,
    { isRoot: false, isAdmin: false },
    {
      open: () => run.open(item),
      preview: () => run.preview(item),
      download: () => run.download(item),
      showInFolder: () => run.showInFolder(item),
      moveInFavorites: () => run.moveInFavorites(item),
      toggleFavorite: () => run.unfavorite(item),
      share: () => run.share(item),
      tags: () => run.tags(item),
      activity: () => run.activity(item),
      rename: () => run.rename(item),
      delete: () => run.remove(item),
      properties: () => run.properties(item),
    },
  );
}

/** The menu of an organizing folder. */
export function favoriteFolderMenu(folder: FavoriteFolderDto, run: FavoriteFolderActions): MenuEntry[] {
  return [
    { label: "Open", icon: "folder-open", onSelect: () => run.open(folder) },
    { label: "Rename", icon: "pencil-simple", separator: true, onSelect: () => run.rename(folder) },
    { label: "Move in favorites", icon: "arrow-bend-up-right", onSelect: () => run.move(folder) },
    { label: "Delete", icon: "trash", danger: true, onSelect: () => run.remove(folder) },
  ];
}
