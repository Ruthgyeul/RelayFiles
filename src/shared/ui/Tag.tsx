import type { MouseEventHandler, ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { Icon, type IconName } from "./icon/Icon";

export interface TagProps {
  children: ReactNode;
  icon?: IconName;
  /** `md` = folder header tags (3px 8px), `sm` = row tags (2px 7px). */
  size?: "sm" | "md";
  title?: string;
  onClick?: MouseEventHandler<HTMLSpanElement>;
  className?: string;
}

/** Small bordered label used for folder settings and user tags (11px, weight 600, radius 6). */
export function Tag({ children, icon, size = "md", title, onClick, className }: TagProps) {
  return (
    <span
      title={title}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      className={cn(
        "inline-flex items-center rounded-md border border-ctrl bg-btn text-[11px] font-semibold text-t2",
        size === "md" ? "gap-[5px] px-2 py-[3px]" : "gap-1 px-[7px] py-0.5",
        className,
      )}
    >
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}
