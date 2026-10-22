import type { ReactNode } from "react";

/** The bar above a document preview: format and size details on the left, view buttons on the right. */
export function DocumentBar({ details, children }: { details: readonly string[]; children?: ReactNode }) {
  return (
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-viewer-line bg-black px-3 py-1.5 text-[12px] text-t4">
      <span className="min-w-0 flex-1 truncate">{details.join(" · ")}</span>
      {children}
    </div>
  );
}
