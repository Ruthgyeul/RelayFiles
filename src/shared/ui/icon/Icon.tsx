import type { CSSProperties } from "react";
import { cn } from "@/shared/lib/cn";
import { ICONS, type IconName } from "./registry";

export type IconWeight = "regular" | "bold" | "fill";

export interface IconProps {
  name: IconName;
  /** `regular` = design `ph`, `bold` = `ph-bold`, `fill` = `ph-fill`. */
  weight?: IconWeight;
  /** Pixel size or CSS length. Defaults to 1em so it follows the surrounding font size like the design's icon font. */
  size?: number | string;
  /** Accessible name. Without it the icon is decorative and hidden from assistive tech. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, weight = "regular", size = "1em", label, className, style }: IconProps) {
  const Component = ICONS[name];
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return <Component weight={weight} size={size} className={cn("shrink-0", className)} style={style} {...a11y} />;
}

export type { IconName };
