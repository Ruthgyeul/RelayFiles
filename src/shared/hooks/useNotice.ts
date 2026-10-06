"use client";

import { useCallback, useRef, useState } from "react";

/** How long a notice stays up (design `note`: 1800 ms). */
const NOTICE_MS = 1_800;

/** The current short notice and a function that shows a new one (replacing the previous). */
export function useNotice(): [string | null, (message: string) => void] {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback((message: string) => {
    clearTimeout(timer.current);
    setNotice(message);
    timer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);
  return [notice, notify];
}
