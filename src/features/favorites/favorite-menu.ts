import type { FavoriteFolderDto } from "@/contracts/favorites";
import type { TaggedItem } from "@/contracts/nodes";
import type { MenuEntry } from "@/features/files/ActionMenu";

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

/** The menu of a favorite: folders open (and share), files preview. */
export function favoriteItemMenu(item: TaggedItem, run: FavoriteItemActions): MenuEntry[] {
  const folder = item.type === "folder";
  return [
    folder ? { label: "Open", icon: "folder-open", onSelect: () => run.open(item) } : { label: "Preview", icon: "eye", onSelect: () => run.preview(item) },
    { label: "Download", icon: "download-simple", onSelect: () => run.download(item) },
    { label: "Show in folder", icon: "arrow-up-right", onSelect: () => run.showInFolder(item) },
    { label: "Move in favorites", icon: "arrow-bend-up-right", separator: true, onSelect: () => run.moveInFavorites(item) },
    { label: "Remove from favorites", icon: "star", onSelect: () => run.unfavorite(item) },
    ...(folder ? [{ label: "Share", icon: "share-network", separator: true, onSelect: () => run.share(item) } satisfies MenuEntry] : []),
    { label: "Tags", icon: "tag", separator: !folder, onSelect: () => run.tags(item) },
    { label: "Link activity", icon: "chart-line-up", onSelect: () => run.activity(item) },
    { label: "Rename", icon: "pencil-simple", separator: true, onSelect: () => run.rename(item) },
    { label: "Delete", icon: "trash", danger: true, onSelect: () => run.remove(item) },
    { label: "Properties", icon: "info", separator: true, onSelect: () => run.properties(item) },
  ];
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
