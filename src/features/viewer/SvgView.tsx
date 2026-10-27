"use client";

import { useEffect, useState, type ReactNode } from "react";
import { FailedPreview, LoadingPreview } from "./PreviewMessage";
import { sanitizedSvg } from "./svg-sanitize";
import { useFileBytes } from "./useFileBytes";

/**
 * An SVG drawn from its source. The server never serves SVG inline (it could run script in
 * the app's origin); here it is sanitized first and shown as an <img> from a blob, so it is only
 * a picture: no script, no network, also when the blob is opened on its own.
 */
export function SvgView({ src, name, tooLarge }: { src: string; name: string; tooLarge: ReactNode }) {
  const file = useFileBytes(src);
  const [url, setUrl] = useState<string | "failed" | null>(null);
  useEffect(() => {
    if (file.status !== "ready") return;
    let objectUrl: string | null = null;
    let live = true;
    // The URL is created outside render so it can be revoked when the bytes go away.
    sanitizedSvg(file.bytes).then(
      (svg) => {
        if (!live) return;
        objectUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        setUrl(objectUrl);
      },
      () => live && setUrl("failed"),
    );
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  if (file.status === "error" || url === "failed") return <FailedPreview />;
  if (file.status === "too-large") return tooLarge;
  if (!url) return <LoadingPreview />;
  return (
    <div className="flex size-full items-center justify-center p-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob, not optimizable by next/image */}
      <img src={url} alt={name} className="max-h-full max-w-full rounded-md bg-white object-contain" />
    </div>
  );
}
