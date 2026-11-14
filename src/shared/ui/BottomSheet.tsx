"use client";

import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/shared/hooks/useDialogFocus";
import { useMounted } from "@/shared/hooks/useMounted";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  label?: string;
  children: ReactNode;
}

/**
 * Mobile (<720px) presentation of popover menus: a sheet anchored to the bottom edge with
 * 44px items and safe-area padding. Same surface tokens as Menu (bg elev, 1px ctrl).
 */
export function BottomSheet({ open, onClose, label, children }: BottomSheetProps) {
  const mounted = useMounted();
  const sheet = useRef<HTMLDivElement>(null);
  // Focus moves to the first item, stays in the sheet and goes back to its trigger on close.
  useDialogFocus(sheet, { open: open && mounted, onClose });

  if (!open || !mounted) return null;
  return createPortal(
    <>
      <div aria-hidden onClick={onClose} className="fixed inset-0 z-(--z-drawer-backdrop) bg-backdrop-drawer" />
      <div
        ref={sheet}
        role="menu"
        aria-label={label}
        className="fixed inset-x-0 bottom-0 z-(--z-drawer) flex max-h-[70dvh] flex-col overflow-auto rounded-t-2xl border-t border-ctrl bg-elev p-1.5 pb-[calc(6px+env(safe-area-inset-bottom))] shadow-popover"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
