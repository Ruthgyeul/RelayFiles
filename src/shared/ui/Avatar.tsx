import { avatarOf } from "@/domain/avatar";
import { cn } from "@/shared/lib/cn";

export interface AvatarProps {
  /** Account id; the identicon is derived from it. */
  seed: string;
  size: 36 | 38 | 68;
  /** Shows the blue "active account" dot (sidebar). */
  active?: boolean;
  /** Ring color around the active dot, matching the surface behind the avatar. */
  dotRing?: string;
  /** Profile header uses a 3px ctrl border. */
  bordered?: boolean;
  label?: string;
  className?: string;
}

/** Circular pixel identicon (`image-rendering: pixelated`) as in the design's account list. */
export function Avatar({ seed, size, active = false, dotRing = "var(--sunk)", bordered = false, label, className }: AvatarProps) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width: size, height: size }}
      className={cn("relative block shrink-0 rounded-full", bordered && "border-[3px] border-ctrl", className)}
    >
      <span
        className="block size-full rounded-full bg-cover bg-center bg-no-repeat [image-rendering:pixelated]"
        style={{ backgroundImage: `url("${avatarOf(seed)}")` }}
      />
      {active && (
        <span
          className="absolute -right-px -bottom-px size-3 rounded-full border-2 bg-active-dot"
          style={{ borderColor: dotRing }}
        />
      )}
    </span>
  );
}
