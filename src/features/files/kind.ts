import type { NodeItem } from "@/contracts/nodes";
import type { FilterKey } from "@/domain/tree";
import { KIND_COLOR } from "@/shared/styles/palette";
import type { IconName } from "@/shared/ui/icon/Icon";

/** Icon and color per item type (design `KIND`); folders use the filled icon. */
export const KIND_ICON: Record<"folder" | NonNullable<NodeItem["kind"]>, { icon: IconName; color: string }> = {
  folder: { icon: "folder-simple", color: KIND_COLOR.folder },
  video: { icon: "file-video", color: KIND_COLOR.video },
  audio: { icon: "file-audio", color: KIND_COLOR.audio },
  image: { icon: "file-image", color: KIND_COLOR.image },
  other: { icon: "file-zip", color: KIND_COLOR.other },
};

export function kindOf(item: Pick<NodeItem, "type" | "kind">) {
  return KIND_ICON[item.type === "folder" ? "folder" : (item.kind ?? "other")];
}

/** Filter chips in the design order with their icons and colors. */
export const FILTER_CHIPS: readonly { key: FilterKey; label: string; icon: IconName; color: string }[] = [
  { key: "all", label: "All", icon: "squares-four", color: "var(--t3)" },
  { key: "folder", label: "Folders", icon: "folder-simple", color: KIND_COLOR.folder },
  { key: "video", label: "Videos", icon: "film-strip", color: KIND_COLOR.video },
  { key: "audio", label: "Audio", icon: "music-note", color: KIND_COLOR.audio },
  { key: "image", label: "Images", icon: "image", color: KIND_COLOR.image },
  { key: "other", label: "Other", icon: "file", color: KIND_COLOR.other },
];

