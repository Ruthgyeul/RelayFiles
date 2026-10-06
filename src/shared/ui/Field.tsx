import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** Height in px: 36 (custom quota), 40 (forms) or 44 (sign-in, share password). */
  height?: 36 | 40 | 44;
  /** Background: `bg` (forms) or `sunk` (sign-in token). */
  surface?: "bg" | "sunk";
  /** Monospace text for tokens and invite codes. */
  mono?: boolean;
}

/** Text field: radius 10, 1px ctrl border, no outline (focus ring comes from :focus-visible). */
export function TextInput({ height = 40, surface = "bg", mono = false, className, ...rest }: TextInputProps) {
  return (
    <input
      className={cn(
        "rounded-[10px] border border-ctrl text-t1 outline-none placeholder:text-t5",
        { 36: "h-9 px-3 text-[14px]", 40: "h-10 px-3 text-[15px]", 44: "h-11 px-3.5 text-[15px]" }[height],
        surface === "bg" ? "bg-bg" : "bg-sunk",
        mono && "font-mono text-[13px]",
        className,
      )}
      {...rest}
    />
  );
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "resize-y rounded-[10px] border border-ctrl bg-bg px-3 py-2.5 text-[14px] text-t1 outline-none placeholder:text-t5",
        className,
      )}
      {...rest}
    />
  );
}

/** Label wrapper used by the design's forms: 13px, weight 600, t3, 6px gap above the control. */
export function Field({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-[13px] font-semibold text-t3", className)}>
      {label}
      {children}
    </label>
  );
}

/** Section label above a group of options (13px, weight 600, t3). */
export function FieldGroup({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="text-[13px] font-semibold text-t3">{label}</span>
      {children}
    </div>
  );
}
