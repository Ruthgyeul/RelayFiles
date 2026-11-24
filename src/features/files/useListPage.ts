"use client";

import { CLOCK_TICK_MS } from "@/config/policy";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NodeItem } from "@/contracts/nodes";
import { useShell } from "@/features/shell/ShellProvider";
import { usePageTitle } from "@/features/shell/usePageTitle";
import { useNow } from "@/shared/hooks/useNow";
import { shareUrl } from "@/shared/lib/routes";
import { useCopyLink } from "./useCopyLink";
import { useFileDialogs } from "./useFileDialogs";
import { useFileMedia } from "./useFileMedia";
import { useSelection } from "@/shared/hooks/useSelection";

interface ListPageOptions<T extends NodeItem> {
  /** The items shown (after filters and search). */
  items: T[];
  /** Page title, also the name of a zip of the items. */
  title: string;
  isAdmin: boolean;
  /** A file to open in the viewer right away (global search `?view=`). */
  initialView?: string;
}

/**
 * What the File Manager and Favorites share around their list: the page title, the clock for
 * relative times, selection, the viewer, the file dialogs, link copying, Properties and Refresh.
 */
export function useListPage<T extends NodeItem>({ items, title, isAdmin, initialView }: ListPageOptions<T>) {
  const router = useRouter();
  const { notify, activeAccount, config } = useShell();
  usePageTitle(title);
  const now = useNow(true, CLOCK_TICK_MS.expiry);
  const [propertiesFor, setPropertiesFor] = useState<string | null>(null);
  const selection = useSelection(items);
  const linkOf = (linkId: string) => shareUrl(config.publicUrl, linkId);
  const media = useFileMedia(items, title, initialView);
  const files = useFileDialogs({ isAdmin, accountDeletesAt: activeAccount?.deletesAt ?? null, linkOf, onChanged: selection.clear });
  const { copyText, copyLink } = useCopyLink();
  const refresh = () => {
    router.refresh();
    notify("Up to date");
  };
  return { router, now, selection, linkOf, media, files, copyText, copyLink, propertiesFor, setPropertiesFor, refresh };
}
