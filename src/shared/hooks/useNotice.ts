"use client";

import { useCallback, useRef, useState } from "react";

/** How long a notice stays up (1800 ms). */
const NOTICE_MS = 1_800;
/** A notice with an action (Undo after a delete) stays long enough to reach it. */
const ACTION_NOTICE_MS = 6_000;

/** A button in a notice ("Undo"); running it closes the notice. */
export interface NoticeAction {
  label: string;
  run: () => void;
}

export interface Notice {
  message: string;
  action?: NoticeAction;
}

/** The current short notice and a function that shows a new one (replacing the previous). */
export function useNotice(): [Notice | null, (message: string, action?: NoticeAction) => void] {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback((message: string, action?: NoticeAction) => {
    clearTimeout(timer.current);
    const close = () => {
      clearTimeout(timer.current);
      setNotice(null);
    };
    setNotice(action ? { message, action: { label: action.label, run: () => (close(), action.run()) } } : { message });
    timer.current = setTimeout(close, action ? ACTION_NOTICE_MS : NOTICE_MS);
  }, []);
  return [notice, notify];
}
