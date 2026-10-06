import type { Tone } from "@/domain/status";

/** Text color for a measured value (design: #4fe0a6 / #f5c04a / #ff8a94, t2 while measuring). */
export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-ok-text",
  warn: "text-warn-text",
  bad: "text-danger-text",
  neutral: "text-t2",
};
