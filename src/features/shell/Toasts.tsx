"use client";

import { Avatar } from "@/shared/ui/Avatar";
import { Icon } from "@/shared/ui/icon/Icon";
import { useShell } from "./ShellProvider";

/** Short confirmation pill (design `note`) and the "Switched to …" account toast. */
export function Toasts() {
  const { notice, accountToast, dismissAccountToast } = useShell();
  return (
    <>
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-[76px] left-1/2 z-(--z-notice) flex -translate-x-1/2 items-center gap-2 rounded-full bg-t1 px-4 py-2.5 text-[14px] font-bold whitespace-nowrap text-bg shadow-popover"
        >
          <Icon name="check" weight="bold" />
          {notice}
        </div>
      )}
      {accountToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-[72px] right-4 z-(--z-account-toast) flex w-[min(340px,calc(100vw-32px))] items-center gap-3 rounded-[14px] border border-ctrl bg-elev py-3 pr-2.5 pl-3.5 shadow-panel"
        >
          <Avatar seed={accountToast.account.id} size={38} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[14px] font-bold">Switched to {accountToast.account.name}</span>
            <span className="text-[12px] text-t4">{accountToast.meta}</span>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={dismissAccountToast}
            className="flex size-[30px] shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-t3 hover:bg-btn-h"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      )}
    </>
  );
}
