import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { buttonClassName, type ButtonSize, type ButtonVariant } from "./Button";
import { Icon, type IconName } from "./icon/Icon";

export interface ButtonLinkProps {
  href: ComponentProps<typeof Link>["href"];
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  hoverable?: boolean;
  className?: string;
  children: ReactNode;
}

/** A link that looks like a Button (navigation actions on error pages and empty states). */
export function ButtonLink({ href, variant = "secondary", size = 40, icon, hoverable = true, className, children }: ButtonLinkProps) {
  return (
    <Link href={href} className={cn(buttonClassName({ variant, size, hoverable }), className)}>
      {icon && <Icon name={icon} />}
      <span>{children}</span>
    </Link>
  );
}
