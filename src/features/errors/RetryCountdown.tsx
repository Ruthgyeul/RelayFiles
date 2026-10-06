"use client";

import { useEffect, useState } from "react";
import { Button } from "@/shared/ui/Button";
import { formatCountdown } from "./presets";

/** 429 screen body: counts down, then enables Retry (reloads the page the user came from). */
export function RetryCountdown({ seconds, retryHref }: { seconds: number; retryHref: string }) {
  const [left, setLeft] = useState(seconds);

  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((value) => value - 1), 1_000);
    return () => clearTimeout(timer);
  }, [left]);

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <p className="m-0 text-[14px] leading-[1.5] text-t3" aria-live="polite">
        {left > 0 ? `Try again in ${formatCountdown(left)}.` : "You can try again now."}
      </p>
      <Button variant="primary" size={40} disabled={left > 0} hoverable onClick={() => window.location.assign(retryHref)}>
        Retry
      </Button>
    </div>
  );
}
