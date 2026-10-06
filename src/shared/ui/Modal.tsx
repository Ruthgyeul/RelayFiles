"use client";

import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/shared/lib/cn";
import { useMounted } from "@/shared/hooks/useMounted";
import { Icon, type IconName } from "./icon/Icon";
import { IconButton } from "./IconButton";

/** Stacking layers from the design (backdrop, panel). */
const LAYER = {
  modal: "z-(--z-modal-backdrop)|z-(--z-modal)",
  token: "z-(--z-token-backdrop)|z-(--z-token)",
  dialog: "z-(--z-dialog-backdrop)|z-(--z-dialog)",
  subdialog: "z-(--z-subdialog-backdrop)|z-(--z-subdialog)",
  shortcuts: "z-(--z-shortcuts-backdrop)|z-(--z-shortcuts)",
  search: "z-(--z-search-backdrop)|z-(--z-search)",
} as const;

export type ModalLayer = keyof typeof LAYER;

/** Lets ModalHeader label its dialog without the caller wiring ids. */
const TitleIdContext = createContext<string | undefined>(undefined);

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Panel width in px; the panel never exceeds `100vw - 24px`. */
  width: number;
  layer?: ModalLayer;
  /** When false, the backdrop and Escape do not close the dialog (e.g. "Save your account token"). */
  dismissible?: boolean;
  /** `strong` = rgba(6,10,20,.7) used behind the token dialog. */
  backdrop?: "default" | "strong";
  /** `top` positions the panel at max(12px, 10vh) like the global search. */
  position?: "center" | "top";
  /** Accessible name when there is no ModalHeader. */
  label?: string;
  className?: string;
  children: ReactNode;
}

/** Centered dialog panel with focus trap, Escape handling and focus restoration. */
export function Modal({
  open,
  onClose,
  width,
  layer = "modal",
  dismissible = true,
  backdrop = "default",
  position = "center",
  label,
  className,
  children,
}: ModalProps) {
  const mounted = useMounted();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [backdropZ, panelZ] = LAYER[layer].split("|");

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const first = node?.querySelector<HTMLElement>("[autofocus]") ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const head = items[0];
      const tail = items[items.length - 1];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail?.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, dismissible, onClose]);

  if (!open || !mounted) return null;
  return createPortal(
    <>
      <div
        aria-hidden
        onClick={dismissible ? onClose : undefined}
        className={cn("fixed inset-0", backdropZ, backdrop === "strong" ? "bg-backdrop-strong" : "bg-backdrop")}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={label ? undefined : titleId}
        tabIndex={-1}
        style={{ width: `min(${width}px, calc(100vw - 24px))` }}
        className={cn(
          "fixed left-1/2 flex max-h-[calc(100dvh-24px)] flex-col overflow-auto rounded-2xl border border-ctrl bg-card shadow-modal outline-none",
          position === "center" ? "top-1/2 -translate-x-1/2 -translate-y-1/2" : "top-[max(12px,10vh)] -translate-x-1/2",
          panelZ,
          className,
        )}
      >
        <TitleIdContext value={titleId}>{children}</TitleIdContext>
      </div>
    </>,
    document.body,
  );
}

export interface ModalHeaderProps {
  title: ReactNode;
  onClose?: () => void;
  icon?: IconName;
  iconColor?: string;
  subtitle?: ReactNode;
  /** Title size: 16 (most dialogs) or 17 (sign in). */
  titleSize?: 16 | 17;
  /** Close button size: 32 or 36. */
  closeSize?: 32 | 36;
}

/** Dialog header row: padding 16px 20px, bottom hairline, title and close button. */
export function ModalHeader({ title, onClose, icon, iconColor, subtitle, titleSize = 16, closeSize = 32 }: ModalHeaderProps) {
  const titleId = useContext(TitleIdContext);
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-card-line px-5 py-4">
      {icon && <Icon name={icon} size={20} style={{ color: iconColor }} className={iconColor ? undefined : "text-accent-icon"} />}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className={cn("m-0 truncate font-bold", titleSize === 16 ? "text-[16px]" : "text-[17px]")} id={titleId}>
          {title}
        </h2>
        {subtitle && <span className="truncate font-mono text-[12px] text-t4">{subtitle}</span>}
      </div>
      {onClose && <IconButton icon="x" label="Close" size={closeSize} iconSize={18} onClick={onClose} />}
    </div>
  );
}

export function ModalBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col gap-4 p-5", className)}>{children}</div>;
}

/** Footer action row: padding 14px 20px, top hairline, right-aligned buttons. */
export function ModalFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex shrink-0 justify-end gap-2 border-t border-card-line px-5 py-3.5", className)}>{children}</div>;
}
