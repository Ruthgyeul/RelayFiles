"use client";

import { useShell } from "@/features/shell/ShellProvider";

/** Copies text with a toast; links say when only the owner can open them. */
export function useCopyLink() {
  const { notify } = useShell();
  const copyText = (text: string, message: string) => {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    notify(message);
  };
  const copyLink = (url: string, visibility: "private" | "public") => copyText(url, visibility === "public" ? "Link copied" : "Link copied · private, only you can open it");
  return { copyText, copyLink };
}
