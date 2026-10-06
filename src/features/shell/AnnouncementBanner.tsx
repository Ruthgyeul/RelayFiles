"use client";

import { useSyncExternalStore } from "react";
import type { AnnouncementDto, AnnouncementLevel } from "@/contracts/server-settings";
import { formatShortDate } from "@/domain/format";
import { useMounted } from "@/shared/hooks/useMounted";
import { readLocalSetting, writeLocalSetting } from "@/shared/lib/local-setting";
import { cn } from "@/shared/lib/cn";
import { Icon, type IconName } from "@/shared/ui/icon/Icon";
import { IconButton } from "@/shared/ui/IconButton";

/** Look per level (design `AL`). */
export const ANNOUNCEMENT_LOOK: Record<AnnouncementLevel, { label: string; icon: IconName; box: string; text: string }> = {
  info: { label: "Notice", icon: "megaphone", box: "border-accent-soft-line bg-accent-soft", text: "text-accent-text" },
  warn: { label: "Warning", icon: "warning", box: "border-warn-line bg-warn-bg", text: "text-warn-text" },
  maint: { label: "Maintenance", icon: "wrench", box: "border-info-line bg-info-bg", text: "text-info-text" },
};

const KEY = "relay.announcements.dismissed";
const isIds = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
/** Dismissed ids kept per browser (only the newest few matter). */
const KEEP = 20;
const listeners = new Set<() => void>();
const dismissedStore = {
  subscribe: (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener)),
  get: () => readLocalSetting(KEY, isIds)?.join(",") ?? "",
  dismiss: (id: string) => {
    writeLocalSetting(KEY, [id, ...(readLocalSetting(KEY, isIds) ?? [])].slice(0, KEEP));
    listeners.forEach((listener) => listener());
  },
};

/** The admin announcement at the top of the File Manager until dismissed (design `annShow`). */
export function AnnouncementBanner({ announcement }: { announcement: AnnouncementDto }) {
  const dismissed = useSyncExternalStore(dismissedStore.subscribe, dismissedStore.get, () => "");
  const mounted = useMounted();
  if (dismissed.split(",").includes(announcement.id)) return null;
  const look = ANNOUNCEMENT_LOOK[announcement.level];
  return (
    <div role="status" className={cn("flex items-start gap-3 rounded-[14px] border py-3.5 pr-2.5 pl-4", look.box)}>
      <Icon name={look.icon} weight="fill" size={20} className={cn("mt-px shrink-0", look.text)} />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className={cn("text-[12px] font-extrabold tracking-[.05em] uppercase", look.text)}>
          {look.label} · {mounted ? formatShortDate(announcement.at) : ""}
        </span>
        <span className="text-[14px] leading-[1.5] whitespace-pre-wrap text-pretty text-t1">{announcement.text}</span>
      </div>
      <IconButton icon="x" label="Dismiss" size={30} iconSize={16} tone="t2" onClick={() => dismissedStore.dismiss(announcement.id)} />
    </div>
  );
}
