import type { HTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

/** Surface card: bg card, 1px cardLine border, radius 16. Padding is set by the caller (design varies it). */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-card-line bg-card", className)} {...rest} />;
}

/**
 * List container whose rows are separated by 1px hairlines: the background shows the
 * cardLine color through a 1px gap between rows, exactly like the design.
 */
export function ListCard({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-px overflow-hidden rounded-2xl border border-card-line bg-card-line", className)} {...rest} />;
}

/** A row inside ListCard (bg card so the hairline gaps show). */
export function ListRow({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("bg-card", className)} {...rest} />;
}
