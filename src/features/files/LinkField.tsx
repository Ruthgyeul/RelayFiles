"use client";

import { useState } from "react";
import { Icon } from "@/shared/ui/icon/Icon";
import { QrCode } from "@/shared/ui/QrCode";

/** Side of the QR code: large enough for a phone camera at arm's length. */
const QR_SIZE_PX = 176;

const fieldButton = "flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-ctrl bg-btn text-t1";

/** An item's share link with copy and a QR code to open it on a phone (drawn in the browser). */
export function LinkField({ url, visibility, onCopy }: { url: string; visibility: "private" | "public"; onCopy: () => void }) {
  const [showQr, setShowQr] = useState(false);
  return (
    <div className="flex flex-col gap-1.5 pt-3">
      <span className="text-[13px] text-t4">Link</span>
      <div className="flex gap-1.5">
        <div className="flex h-9 min-w-0 flex-1 items-center truncate rounded-[10px] border border-ctrl bg-bg px-2.5 font-mono text-[12px] text-accent-text">{url}</div>
        <button type="button" title="QR code" aria-label="QR code" aria-pressed={showQr} onClick={() => setShowQr((shown) => !shown)} className={fieldButton}>
          <Icon name="qr-code" />
        </button>
        <button type="button" title="Copy link" aria-label="Copy link" onClick={onCopy} className={fieldButton}>
          <Icon name="copy" />
        </button>
      </div>
      {showQr && (
        <div className="flex flex-col items-center gap-2 pt-2">
          <QrCode text={url} size={QR_SIZE_PX} label={`QR code for ${url}`} />
          <span className="text-center text-[12px] text-t4">{visibility === "public" ? "Scan to open this link on a phone" : "Private link: it opens only where you are signed in"}</span>
        </div>
      )}
    </div>
  );
}
