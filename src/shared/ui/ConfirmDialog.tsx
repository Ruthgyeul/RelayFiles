"use client";

import type { ReactNode } from "react";
import { TONE } from "@/shared/styles/palette";
import { Button } from "./Button";
import { Icon, type IconName } from "./icon/Icon";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` = red icon box and red confirm button (deletions); `accent` = primary button. */
  tone?: "danger" | "accent";
  icon?: IconName;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation dialog in the style of the design's delete dialog (w400). Replaces the
 * prototype's native window.confirm calls so the theme and mobile layout stay consistent.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  icon = tone === "danger" ? "trash" : "info",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const colors = TONE[tone];
  return (
    <Modal open={open} onClose={onCancel} width={400} layer="dialog" label={typeof title === "string" ? title : confirmLabel} className="gap-3 px-5 pt-[22px] pb-[18px]">
      <span className="flex size-11 items-center justify-center rounded-xl" style={{ background: colors.bg }}>
        <Icon name={icon} weight="fill" size={22} style={{ color: colors.icon }} />
      </span>
      <h2 className="m-0 text-[17px] font-bold [overflow-wrap:anywhere]">{title}</h2>
      {description && <p className="m-0 text-[14px] leading-[1.5] text-pretty text-t3">{description}</p>}
      <div className="mt-1.5 flex justify-end gap-2">
        <Button size={38} className="px-4" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button size={38} className="px-4" variant={tone === "danger" ? "danger-solid" : "primary"} onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
