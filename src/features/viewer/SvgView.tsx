"use client";

import { useEffect, useState, type ReactNode } from "react";
import { FailedPreview, LoadingPreview } from "./PreviewMessage";
import { useFileBytes } from "./useFileBytes";

/**
 * An SVG drawn from its source. The server never serves SVG inline (it could run script in
 * the app's origin); as an <img> from a blob it is only a picture: no script, no network.
 */
export function SvgView({ src, name, tooLarge }: { src: string; name: string; tooLarge: ReactNode }) {
  const file = useFileBytes(src);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (file.status !== "ready") return;
    const objectUrl = URL.createObjectURL(new Blob([file.bytes], { type: "image/svg+xml" }));
    // The URL is created outside render so it can be revoked when the bytes go away.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the blob URL is an external resource tied to this effect
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (file.status === "error") return <FailedPreview />;
  if (file.status === "too-large") return tooLarge;
  if (!url) return <LoadingPreview />;
  return (
    <div className="flex size-full items-center justify-center p-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob, not optimizable by next/image */}
      <img src={url} alt={name} className="max-h-full max-w-full rounded-md bg-white object-contain" />
    </div>
  );
}
