import type { LinkEventKind } from "@/contracts/nodes";
import { FIXED_COLOR, KIND_COLOR } from "@/shared/styles/palette";
import type { IconName } from "@/shared/ui/icon/Icon";

/** Label, icon and color per link event in the Activity dialog. */
export const EVENT_LOOK: Record<LinkEventKind, { label: string; icon: IconName; color: string }> = {
  open: { label: "Opened link", icon: "globe-simple", color: "var(--accentIcon)" },
  play: { label: "Played", icon: "play", color: KIND_COLOR.audio },
  view: { label: "Viewed", icon: "eye", color: KIND_COLOR.image },
  download: { label: "Downloaded", icon: "download-simple", color: FIXED_COLOR.warnOrange },
  reset: { label: "Link regenerated", icon: "arrows-clockwise", color: FIXED_COLOR.dangerText },
};
