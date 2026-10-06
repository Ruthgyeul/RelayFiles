"use client";

import Link from "next/link";
import type { Route } from "next";
import { APP_VERSION } from "@/config/version";
import { STATUS_TITLE, type StatusLevel } from "@/domain/status";
import { FIXED_COLOR } from "@/shared/styles/palette";
import { Logo } from "@/shared/ui/Display";
import { Icon } from "@/shared/ui/icon/Icon";
import { useHealth } from "./useHealth";

const DOT_COLOR: Record<StatusLevel, string> = { ok: FIXED_COLOR.okText, warn: FIXED_COLOR.warnText, down: FIXED_COLOR.dangerText };

/** Footer: brand, tagline, live status (links to Status), shortcuts, version. */
export function AppFooter({ onShortcuts }: { onShortcuts: () => void }) {
  const level = useHealth();
  return (
    <footer className="mx-auto box-border flex w-full max-w-[880px] flex-wrap items-center gap-x-5 gap-y-2.5 border-t border-line px-4 pt-5 pb-7 text-[13px] text-t4">
      <span className="flex items-center gap-2 font-bold text-t2">
        <Logo size={22} />
        RelayFiles
      </span>
      <span>Private file sharing &amp; streaming</span>
      <span className="flex-1" />
      <Link href={"/status" as Route} className="flex items-center gap-1.5 text-[13px] font-semibold text-t2 no-underline hover:text-t2">
        <span className="size-2 rounded-full" style={{ background: level ? DOT_COLOR[level] : "var(--t5)" }} />
        {level ? STATUS_TITLE[level] : "Checking…"}
      </Link>
      <button type="button" onClick={onShortcuts} className="flex items-center gap-1.5 border-0 bg-transparent p-0 text-[13px] font-semibold text-t2">
        <Icon name="keyboard" />
        Shortcuts <span className="rounded-[5px] border border-ctrl px-1.5 py-px text-[11px]">?</span>
      </button>
      <span>
        v{APP_VERSION} · © {new Date().getFullYear()}
      </span>
    </footer>
  );
}
