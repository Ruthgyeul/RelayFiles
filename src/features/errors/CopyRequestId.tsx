"use client";

import { useState } from "react";
import { Icon } from "@/shared/ui/icon/Icon";

/** Shows the request id / error digest with a copy button so users can report it. */
export function CopyRequestId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title="Copy reference"
      className="mt-1 flex items-center gap-1.5 border-0 bg-transparent p-0 font-mono text-[12px] text-t5"
    >
      Ref {value}
      <Icon name={copied ? "check" : "copy"} size={12} />
    </button>
  );
}
