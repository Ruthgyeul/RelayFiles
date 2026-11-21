"use client";

import { useShell } from "@/features/shell/ShellProvider";
import { COPY_FAILED, copyText } from "@/shared/lib/clipboard";

/** Copies text with a toast ("Copy failed" when it did not reach the clipboard); links say when only the owner can open them. */
export function useCopyLink() {
  const { notify } = useShell();
  const copyWithNotice = (text: string, message: string) => {
    void copyText(text).then((copied) => notify(copied ? message : COPY_FAILED));
  };
  const copyLink = (url: string, visibility: "private" | "public") => copyWithNotice(url, visibility === "public" ? "Link copied" : "Link copied · private, only you can open it");
  return { copyText: copyWithNotice, copyLink };
}
