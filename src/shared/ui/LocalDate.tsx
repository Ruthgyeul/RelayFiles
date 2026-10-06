"use client";

import { useMounted } from "@/shared/hooks/useMounted";

/**
 * Formats a date in the viewer's time zone. The server does not know that zone, so the
 * text appears after hydration (an empty span keeps the layout stable until then).
 */
export function LocalDate({ value, format }: { value: string | number | Date; format: (date: Date) => string }) {
  const mounted = useMounted();
  const date = new Date(value);
  return <time dateTime={date.toISOString()}>{mounted ? format(date) : ""}</time>;
}
